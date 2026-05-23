import os
import sqlite3
import time
from functools import wraps
from typing import Any, Dict, Optional

import bcrypt
import click
from flask import Flask, abort, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

# ==============================================================================
# Configuration & Environment
# ==============================================================================
DATABASE_PATH = os.getenv("DATABASE_PATH", "counters.db")
PASSWORD_FILE = os.getenv("PASSWORD_FILE", ".password")

def create_app() -> Flask:
    # Serve static files from the 'www' directory at the root URL path
    app = Flask(__name__, static_folder='www', static_url_path='/')

    # ==============================================================================
    # Database Setup & Helpers
    # ==============================================================================
    def get_db() -> sqlite3.Connection:
        if '_database' not in g:
            g._database = sqlite3.connect(DATABASE_PATH)
            g._database.row_factory = sqlite3.Row
            g._database.execute("""
                CREATE TABLE IF NOT EXISTS counters (
                    name TEXT PRIMARY KEY,
                    description TEXT,
                    timestamp INTEGER,
                    precision TEXT,
                    info TEXT
                )
            """)
            g._database.commit()
        return g._database

    @app.teardown_appcontext
    def close_connection(exception: Optional[BaseException]):
        db = g.pop('_database', None)
        if db is not None:
            db.close()

    def row_to_dict(row: sqlite3.Row, current_time: Optional[int] = None) -> Dict[str, Any]:
        """Serializes a SQLite row into a dictionary with proper type boundaries."""
        now = current_time or int(time.time())
        return {
            "name": str(row["name"]),
            "description": str(row["description"]),
            "timestamp": int(row["timestamp"]),
            "precision": str(row["precision"]),
            "info": str(row["info"]) if row["info"] else "",
            "timesince": now - int(row["timestamp"])
        }

    # ==============================================================================
    # Static File Routing
    # ==============================================================================
    @app.route('/')
    def serve_index():
        """Serves the main frontend application."""
        return send_from_directory('www', 'index.html')
    
    @app.route('/admin')
    def serve_admin():
        """Serves the admin dashboard."""
        return send_from_directory('www', 'admin.html')

    # ==============================================================================
    # Authentication Middleware
    # ==============================================================================
    def require_auth(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            auth = request.authorization
            if not auth or not auth.password:
                return jsonify({"error": "Authentication required"}), 401, {'WWW-Authenticate': 'Basic realm="Admin Access"'}
            
            if not os.path.exists(PASSWORD_FILE) or os.path.getsize(PASSWORD_FILE) == 0:
                return jsonify({"error": "Admin functions are permanently locked."}), 403

            try:
                with open(PASSWORD_FILE, "r", encoding="utf-8") as file:
                    admin_hash = file.read().strip()
            except IOError:
                abort(500, description="Failed to read security configuration.")

            if not admin_hash or not bcrypt.checkpw(auth.password.encode('utf-8'), admin_hash.encode('utf-8')):
                return jsonify({"error": "Invalid credentials"}), 403
                
            return f(*args, **kwargs)
        return decorated

    # ==============================================================================
    # API Endpoints
    # ==============================================================================
    @app.route('/counters', methods=['GET'])
    def get_counters():
        now = int(time.time())
        cursor = get_db().execute("SELECT * FROM counters")
        return jsonify([row_to_dict(row, now) for row in cursor.fetchall()])

    @app.route('/counter/<string:name>', methods=['GET'])
    def get_counter(name: str):
        row = get_db().execute("SELECT * FROM counters WHERE name = ?", (name,)).fetchone()
        if not row:
            abort(404, description=f"Counter '{name}' not found.")
        return jsonify(row_to_dict(row))

    @app.route('/counter/<string:name>/<string:property>', methods=['GET'])
    def get_counter_property(name: str, property: str):
        row = get_db().execute("SELECT * FROM counters WHERE name = ?", (name,)).fetchone()
        if not row:
            abort(404, description=f"Counter '{name}' not found.")
            
        counter_dict = row_to_dict(row)
        if property not in counter_dict:
            abort(404, description=f"Property '{property}' not found on counter '{name}'.")
            
        return jsonify({property: counter_dict[property]})

    @app.route('/counter/<string:name>', methods=['PUT'])
    @require_auth
    def edit_counter(name: str):
        payload: Dict[str, Any] = request.get_json() or {}
        db = get_db()
        
        existing = db.execute("SELECT * FROM counters WHERE name = ?", (name,)).fetchone()
        
        desc = payload.get("description", existing["description"] if existing else "")
        ts = payload.get("timestamp", existing["timestamp"] if existing else int(time.time()))
        prec = payload.get("precision", existing["precision"] if existing else "")
        info = payload.get("info", existing["info"] if existing else "")

        db.execute("""
            INSERT INTO counters (name, description, timestamp, precision, info) 
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET 
                description=excluded.description, 
                timestamp=excluded.timestamp, 
                precision=excluded.precision,
                info=excluded.info
        """, (name, desc, ts, prec, info))
        db.commit()
        
        updated = db.execute("SELECT * FROM counters WHERE name = ?", (name,)).fetchone()
        if not updated:
            abort(500, description="Failed to retrieve the updated counter record.")
            
        return jsonify(row_to_dict(updated))

    @app.route('/counter/<string:name>/reset', methods=['POST'])
    @require_auth
    def reset_counter(name: str):
        db = get_db()
        row = db.execute("SELECT * FROM counters WHERE name = ?", (name,)).fetchone()
        if not row:
            abort(404, description=f"Counter '{name}' not found.")
            
        db.execute("UPDATE counters SET timestamp = ? WHERE name = ?", (int(time.time()), name))
        db.commit()
        
        updated = db.execute("SELECT * FROM counters WHERE name = ?", (name,)).fetchone()
        if not updated:
            abort(500, description="Failed to retrieve the updated counter record.")
            
        return jsonify(row_to_dict(updated))

    @app.route('/lockout', methods=['POST'])
    @require_auth
    def lockout_admin():
        """Permanently locks out admin access by clearing the password file."""
        try:
            with open(PASSWORD_FILE, "w", encoding="utf-8") as f:
                f.write("")
            return jsonify({"message": "Lockout triggered successfully. Modifications are now disabled."})
        except IOError:
            abort(500, description="Failed to securely wipe the password file.")

    @app.route('/counter/<string:name>', methods=['DELETE'])
    @require_auth
    def delete_counter(name: str):
        db = get_db()
        row = db.execute("SELECT * FROM counters WHERE name = ?", (name,)).fetchone()
        if not row:
            abort(404, description=f"Counter '{name}' not found.")
            
        db.execute("DELETE FROM counters WHERE name = ?", (name,))
        db.commit()
        return jsonify({"message": f"Counter '{name}' deleted successfully."})

    # ==============================================================================
    # Global Error Handlers
    # ==============================================================================
    @app.errorhandler(HTTPException)
    def handle_http_exception(e: HTTPException):
        return jsonify(error=str(e.description)), e.code or 500

    @app.errorhandler(Exception)
    def handle_generic_exception(e: Exception):
        return jsonify(error="An unexpected internal server error occurred."), 500

    # ==============================================================================
    # CLI Commands
    # ==============================================================================
    @app.cli.command("set-password")
    @click.argument("password")
    def set_password_cli(password: str):
        """Generates and stores a bcrypt hash for the admin password."""
        print("Generating secure password hash...")
        salt = bcrypt.gensalt(rounds=12)
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        
        with open(PASSWORD_FILE, "w", encoding="utf-8") as f:
            f.write(hashed.decode('utf-8'))
        print(f"Success: Password hash securely written to {PASSWORD_FILE}")

    return app


# WSGI App Entry Point
app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)
