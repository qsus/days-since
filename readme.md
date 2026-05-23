# Počítadlo času od různých posledních událostí na MFF

## Nastavení hesla
```bash
flask --app app set-password <heslo>
```

## Spuštění serveru
```bash
flask --app app run
```

```bash
gunicorn -w 4 app:app
```

## Systemd služba
```bash
sudo cp days-since.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now days-since
```
