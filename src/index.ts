import 'reflect-metadata';

import fs from 'fs';
import path from 'path';
import { Container } from 'typedi';
import { ServerOptions } from 'http-proxy';
import { YxorpServer } from './services/yxorp-server.service';
import { ConfigFile } from './types/yxorp-config';
import { ProxyConfigToken } from './services/config.service';


let config: ConfigFile;

try {
  config = JSON.parse(fs.readFileSync('./yxopr.json').toString()) as ConfigFile;
} catch(e) {
  console.error(e);
  throw 'Can\'t read yxopr.json'
}

globalThis.require = require;

const proxyOptions: ServerOptions = {
  target: config.target,
  changeOrigin: true,
  followRedirects: true,
  secure: false,
  localAddress: '0.0.0.0',
  ws: true,
  selfHandleResponse: true,
};

const proxyConfig = {
  ...config,
  proxyOptions,
}

config?.scripts?.forEach(script => {
  require(path.join(process.cwd(), script));
});

Container.set(ProxyConfigToken, proxyConfig);

const server = Container.get(YxorpServer);

server.listen(config.proxyPort, () => {
  console.log(`Yxorp server started successfully on http://localhost:${config.proxyPort}`);
});
