```json
{
  "type": "object",
  "properties": {
    "email": { "type": "string", "format": "email" },
    "password": { "type": "string", "minLength": 8 },
    "name": { "type": "string" }
  },
  "required": ["email", "password"]
}
```
