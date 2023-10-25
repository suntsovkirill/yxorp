# Yxorp
This is a simple CLI reverse proxy utility for rewriting or mocking API data. It is in early development and may contain many bugs 😊

## Installation
```
npm i -g yxopr
```
## Usage
Just run yxopr in folder which contains yxopr.json

## Config
Simple yxopr.json example:
```json
{
  "#": "The site that will be proxied"
  "target": "http://example.com/",
  "port": 3002,
  "#": "Makes static path with files in directory",
  "staticRules": [
    {
      "path": "/some-path-on-server",
      "directory": "./some-path-with-static-files",
      "disable": false
    }
  ],
  "#": "Scripts may be using for set some data for mock scripts",
  "scripts": [
    "./scripts/some-data.js"
  ],
  "#": "For matching paths in mockRules and rewriteRules uses https://www.npmjs.com/package/path-to-regex",
  "#": "This rules uses to modify API data",
  "mockRules": [
    {
      "method": "GET",
      "path": "/api/example-one(.*)",
      "script": "./mock/api/example-one.js",
      "disable": false
    }, {
      "method": "GET",
      "path": "/api/example-two(.*)",
      "file": "./mock/api/example-two.json",
      "statusCode": 200,
      "disable": false
    }
  ]
  "rewriteRules": [
    {
      "method": "GET",
      "path": "/api/example-one(.*)",
      "script": "./rewrite/api/example-one.js",
      "disable": false
    }, {
      "method": "GET",
      "path": "/api/example-two(.*)",
      "file": "./rewrite/api/example-two.json",
      "statusCode": 200,
      "disable": false
    }
  ]
}
```

## Mock script example
```javascript
var data = {
  error: "some error",
};

res.statusCode = 500;
res.end(Buffer.from(JSON.stringify(data)));
```

## Rewrite script example
```javascript
const data = JSON.parse(body.toString());

data.modify = 'from js 123';

result = Buffer.from(JSON.stringify(data));

```
