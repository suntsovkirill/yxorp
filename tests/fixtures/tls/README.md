Self-signed certificate for `localhost` used only by the HTTPS tests. Not a
secret — never use it for anything else. Regenerate with:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout localhost-test-key.pem -out localhost-test-cert.pem
```
