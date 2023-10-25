import { Service } from 'typedi';
import { ServerResponse, IncomingMessage } from 'http';
import path from 'path';
import fs from 'fs/promises';
import mime from 'mime';
import { Dirent } from 'fs';
import { Config } from '../services/config.service';
import { Middleware } from '../services/pipeline.service';
import { LoggerService } from '../services/logger.service';


@Service({
  global: true
})
export class StaticMiddleware implements Middleware<[req: IncomingMessage, res: ServerResponse]> {
  constructor(
    private config: Config,
    private logger: LoggerService,
  ) {
  }

  public async use(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    try {
      const staticRules = this.config.get().staticRules || [];

      const url = new URL(req.url || '', 'http://fake.com');
      const urlPath = url.pathname;

      if (!staticRules) {
        next();
        return;
      }

      const currentStaticRule = staticRules.filter((staticRule) => {
        return urlPath.startsWith(staticRule.path);
      })[0];

      if (!currentStaticRule) {
        next();
        return;
      }

      const pathToDirectory = path.resolve(currentStaticRule.directory);

      const dirents = await this.readdir(pathToDirectory);

      const filePath = dirents
        .filter(dirent => !dirent.isDirectory())
        .map(dirent => ({
          urlPath: path.join(
            currentStaticRule.path,
            path.join(dirent.path, dirent.name).replace(pathToDirectory, '')
          ).replace(/\\/g, '/'),
          path: path.join(dirent.path, dirent.name).replace(/\\/g, '/'),
        }
        ))
        .filter(dirent => {
          const pathname = path.extname(urlPath)
            ? urlPath
            : path.join(urlPath, currentStaticRule.directoryIndex || '').replace(/\\/g, '/');

          if (currentStaticRule.caseInsensitive) {
            return dirent.urlPath.toLocaleLowerCase() === pathname.toLowerCase();
          } else {
            return dirent.urlPath === pathname;
          }
        })
        .map(dirent => dirent.path)[0];


      if (!filePath) {
        next();
        return;
      }

      const file = await fs.readFile(path.resolve(filePath));
      const mimeType = mime.getType(path.resolve(filePath));

      if (mimeType) {
        res.setHeader('content-type', mimeType);
      }

      res.setHeader('content-length', file.length);
      res.end(file);

      this.logger.info(`[STATIC] ${req.url}`);
    } catch (e) {
      this.logger.error(e);
      next();
    }
  }

  private async readdir(pathname: string, subpathname?: string): Promise<Dirent[]> {
    const files: Dirent[] = [];
    const fullpath = path.join(pathname, subpathname || '');

    const dirents = await fs.readdir(fullpath, {
      withFileTypes: true,
    });

    for (let dirent of dirents) {
      dirent.path = fullpath;
      files.push(dirent);

      if (dirent.isDirectory()) {
        files.push(...await this.readdir(fullpath, dirent.name));
      }
    }

    return files;
  }

}
