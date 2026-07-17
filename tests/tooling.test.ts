// Guards the linting pipeline configuration (Biome, package scripts, CI
// workflow) against regressions. These are plain file-integrity checks — they
// read the committed config from disk rather than importing runtime code — so a
// future edit that drops the format check or a lint rule fails the suite.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fromRoot = (relative: string): string =>
  fileURLToPath(new URL(`../${relative}`, import.meta.url));

const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fromRoot(relative), 'utf8'));

const readText = (relative: string): string =>
  readFileSync(fromRoot(relative), 'utf8');

describe('biome configuration', () => {
  // biome-ignore lint/suspicious/noExplicitAny: config is untyped JSON.
  const biome = readJson('biome.json') as any;

  it('enables the linter with the recommended rule set', () => {
    expect(biome.linter.enabled).toBe(true);
    expect(biome.linter.rules.recommended).toBe(true);
  });

  it('enables the formatter and import organization', () => {
    expect(biome.formatter.enabled).toBe(true);
    expect(biome.organizeImports.enabled).toBe(true);
  });

  it('layers project-specific rules on top of the recommended set', () => {
    expect(biome.linter.rules.correctness.noUnusedImports).toBe('error');
    expect(biome.linter.rules.correctness.noUnusedVariables).toBe('error');
    expect(biome.linter.rules.style.useImportType).toBe('error');
    expect(biome.linter.rules.style.useNodejsImportProtocol).toBe('error');
  });

  it('integrates with git so ignored files are skipped', () => {
    expect(biome.vcs.enabled).toBe(true);
    expect(biome.vcs.useIgnoreFile).toBe(true);
  });
});

describe('package scripts', () => {
  // biome-ignore lint/suspicious/noExplicitAny: config is untyped JSON.
  const pkg = readJson('package.json') as any;
  const scripts: Record<string, string> = pkg.scripts;

  it('exposes a lint script backed by biome check', () => {
    expect(scripts.lint).toBe('biome check .');
  });

  it('exposes a non-writing format check distinct from the writing formatter', () => {
    expect(scripts['format:check']).toBe('biome format .');
    expect(scripts.format).toContain('--write');
    expect(scripts['format:check']).not.toContain('--write');
  });

  it('wires lint and format checks into the aggregate check script', () => {
    expect(scripts.check).toContain('lint');
    expect(scripts.check).toContain('format:check');
  });
});

describe('lint CI workflow', () => {
  const workflow = readText('.github/workflows/lint.yml');

  it('runs on both push and pull_request events', () => {
    expect(workflow).toContain('push:');
    expect(workflow).toContain('pull_request:');
  });

  it('runs the lint and format-check scripts', () => {
    expect(workflow).toContain('pnpm run lint');
    expect(workflow).toContain('pnpm run format:check');
  });
});
