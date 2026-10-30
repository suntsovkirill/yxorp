import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { MockRule } from '../types/yxorp-config';
import { escapePathPattern } from './recorder';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

// Recursion limit for schema samples — specs often have self-referencing schemas.
const MAX_DEPTH = 6;

export interface GeneratedMocks {
  mockRules: MockRule[];
  // Operations no mock could be made for, with the reason.
  skipped: string[];
}

export interface OpenApiMockOptions {
  // Prefix for every path. Default: the path of the first server URL
  // (OpenAPI 3) or `basePath` (Swagger 2).
  basePath?: string;
}

/** Reads an OpenAPI 3 / Swagger 2 spec from a JSON or YAML file. */
export function readSpec(file: string): any {
  const raw = fs.readFileSync(file, 'utf-8');
  return /\.ya?ml$/i.test(file) ? parseYaml(raw) : JSON.parse(raw);
}

/**
 * Generates one mock rule per operation of an OpenAPI 3 or Swagger 2 spec:
 * the operation's success response (lowest 2xx, else `default`) as inline
 * `json` (or `body` for text), taken from its example — or, when there is
 * none, a sample built from its schema (examples, defaults, enums and formats
 * included). `{param}` path segments become `:param`.
 */
export function generateMocksFromOpenApi(spec: any, options: OpenApiMockOptions = {}): GeneratedMocks {
  if (!spec || typeof spec !== 'object' || (!spec.openapi && !spec.swagger)) {
    throw new Error('Not an OpenAPI 3 or Swagger 2 document (no "openapi"/"swagger" field)');
  }

  const basePath = normalizeBasePath(options.basePath ?? defaultBasePath(spec));
  const mockRules: MockRule[] = [];
  const skipped: string[] = [];

  for (const [specPath, pathItem] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of METHODS) {
      const operation = pathItem?.[method];

      if (!operation) {
        continue;
      }

      const label = `${method.toUpperCase()} ${specPath}`;
      const picked = pickResponse(operation.responses ?? {});

      if (!picked) {
        skipped.push(`${label}: no 2xx or default response`);
        continue;
      }

      const response = resolveRef(spec, picked.response);
      const sample = responseSample(spec, response, operation, spec.produces);
      const statusCode = picked.status === 'default' ? 200 : Number(picked.status);
      const rule = {
        method: method.toUpperCase(),
        path: toPathPattern(basePath + specPath),
        ...(statusCode !== 200 ? { statusCode } : {}),
      };

      if (statusCode === 204 || !sample) {
        if (statusCode === 204 || !hasContent(response)) {
          mockRules.push({ ...rule, body: '' } as MockRule);
        } else {
          skipped.push(`${label}: no JSON or text response content`);
        }
        continue;
      }

      mockRules.push({ ...rule, ...sample } as MockRule);
    }
  }

  return { mockRules, skipped };
}

function defaultBasePath(spec: any): string {
  if (spec.swagger) {
    return spec.basePath ?? '';
  }

  const url = spec.servers?.[0]?.url;

  if (typeof url !== 'string' || url.includes('{')) {
    return '';
  }

  try {
    return new URL(url, 'http://placeholder').pathname;
  } catch {
    return '';
  }
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, '');
  return !trimmed || trimmed === '/' ? '' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** `/users/{id}/files.{ext}` → `/users/:id/files.:ext`, other reserved characters escaped. */
export function toPathPattern(specPath: string): string {
  return specPath
    .split(/(\{[^}]+\})/)
    .map((part) => {
      const param = /^\{([^}]+)\}$/.exec(part);

      if (!param) {
        return escapePathPattern(part);
      }

      const name = param[1];
      return /^[A-Za-z_$][\w$]*$/.test(name) ? `:${name}` : `:${JSON.stringify(name)}`;
    })
    .join('');
}

function pickResponse(responses: Record<string, any>): { status: string; response: any } | undefined {
  const success = Object.keys(responses)
    .filter(status => /^2\d\d$/.test(status))
    .sort()[0];

  const status = success ?? (responses.default ? 'default' : undefined);
  return status ? { status, response: responses[status] } : undefined;
}

function hasContent(response: any): boolean {
  return !!(response?.content && Object.keys(response.content).length) || !!response?.schema;
}

/** The response as `{ json }` or `{ body }`, or undefined if it has no usable content. */
function responseSample(spec: any, response: any, operation: any, globalProduces?: string[]): { json: unknown } | { body: string } | undefined {
  // OpenAPI 3: response.content[mediaType].{example, examples, schema}
  if (response?.content) {
    const entries = Object.entries<any>(response.content);
    const json = entries.find(([type]) => /json/i.test(type));
    const text = entries.find(([type]) => /^text\//i.test(type));

    if (json) {
      return { json: mediaExample(spec, json[1]) };
    }

    if (text) {
      const value = mediaExample(spec, text[1]);
      return { body: typeof value === 'string' ? value : JSON.stringify(value) };
    }

    return undefined;
  }

  // Swagger 2: response.examples[mimeType] / response.schema
  if (response?.schema || response?.examples) {
    const produces: string[] = operation.produces ?? globalProduces ?? ['application/json'];
    const example = Object.entries<any>(response.examples ?? {}).find(([type]) => /json/i.test(type))?.[1];

    if (example !== undefined) {
      return { json: example };
    }

    if (produces.some(type => /json/i.test(type)) && response.schema) {
      return { json: sampleFromSchema(spec, response.schema, 0) };
    }
  }

  return undefined;
}

function mediaExample(spec: any, media: any): unknown {
  if (media.example !== undefined) {
    return media.example;
  }

  const firstExample = Object.values<any>(media.examples ?? {})[0];

  if (firstExample !== undefined) {
    const resolved = resolveRef(spec, firstExample);
    return resolved?.value ?? resolved;
  }

  return media.schema ? sampleFromSchema(spec, media.schema, 0) : null;
}

/** Builds a plausible value for a JSON schema. */
export function sampleFromSchema(spec: any, schemaOrRef: any, depth: number): unknown {
  const schema = resolveRef(spec, schemaOrRef);

  if (!schema || typeof schema !== 'object' || depth > MAX_DEPTH) {
    return null;
  }

  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((merged: any, part: any) => {
      const value = sampleFromSchema(spec, part, depth + 1);
      return value && typeof value === 'object' && !Array.isArray(value) ? { ...merged, ...value } : merged;
    }, {});
  }

  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];

  if (variant) {
    return sampleFromSchema(spec, variant, depth + 1);
  }

  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type;

  switch (type ?? (schema.properties ? 'object' : schema.items ? 'array' : undefined)) {
    case 'object': {
      const result: Record<string, unknown> = {};

      for (const [name, property] of Object.entries<any>(schema.properties ?? {})) {
        result[name] = sampleFromSchema(spec, property, depth + 1);
      }

      return result;
    }
    case 'array':
      return depth >= MAX_DEPTH ? [] : [sampleFromSchema(spec, schema.items, depth + 1)];
    case 'string':
      return sampleString(schema.format);
    case 'integer':
      return schema.minimum ?? 0;
    case 'number':
      return schema.minimum ?? 0;
    case 'boolean':
      return true;
    default:
      return null;
  }
}

function sampleString(format: string | undefined): string {
  switch (format) {
    case 'date-time': return '2024-01-01T00:00:00Z';
    case 'date': return '2024-01-01';
    case 'time': return '00:00:00';
    case 'email': return 'user@example.com';
    case 'uuid': return '00000000-0000-4000-8000-000000000000';
    case 'uri':
    case 'url': return 'https://example.com';
    case 'hostname': return 'example.com';
    case 'ipv4': return '127.0.0.1';
    case 'byte': return 'c3RyaW5n';
    default: return 'string';
  }
}

/** Follows a local `$ref` (`#/components/schemas/User`, `#/definitions/User`). */
function resolveRef(spec: any, value: any, seen = new Set<string>()): any {
  const ref = value?.$ref;

  if (typeof ref !== 'string' || !ref.startsWith('#/') || seen.has(ref)) {
    return typeof ref === 'string' ? undefined : value;
  }

  seen.add(ref);

  const target = ref
    .slice(2)
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node: any, key) => node?.[key], spec);

  return resolveRef(spec, target, seen);
}

/** `yxorp openapi <spec> [--out file] [--base-path path]` — writes `{ "mockRules": [...] }`. */
export function writeMocksFromOpenApi(specFile: string, outFile: string, options: OpenApiMockOptions = {}): GeneratedMocks {
  const generated = generateMocksFromOpenApi(readSpec(specFile), options);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ mockRules: generated.mockRules }, null, 2) + '\n');

  return generated;
}
