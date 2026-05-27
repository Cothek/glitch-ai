import { readFile } from 'fs/promises';

export class Vault {
  constructor(parsed) {
    this._sections = parsed || {};
  }

  static async load(filePath) {
    const content = await readFile(filePath, 'utf-8');
    const parsed = Vault._parse(content);
    return new Vault(parsed);
  }

  static _parse(content) {
    const sections = {};
    let currentSection = null;

    const lines = content.replace(/\r\n/g, '\n').split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line || line.startsWith('#') || line.startsWith(';')) {
        continue;
      }

      const sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        if (!sections[currentSection]) {
          sections[currentSection] = {};
        }
        continue;
      }

      if (!currentSection) {
        continue;
      }

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }

      const key = line.substring(0, eqIndex).trim();
      let value = line.substring(eqIndex + 1).trim();

      // Strip inline comments for unquoted values (# or ; preceded by a space)
      if (!value.startsWith('"') && !value.startsWith("'")) {
        const commentMatch = value.match(/^(.*?)\s+[;#]/);
        if (commentMatch) {
          value = commentMatch[1].trimEnd();
        }
      }

      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      value = value.replace(/\\n/g, '\n');

      sections[currentSection][key] = value;
    }

    return sections;
  }

  getSection(name) {
    return this._sections[name] || null;
  }

  listSections() {
    return Object.keys(this._sections);
  }

  getEnv(project, env) {
    const base = this._sections[project];
    if (!base) {
      return null;
    }

    const result = { ...base };

    if (env) {
      const overrideKey = `${project}:${env}`;
      const override = this._sections[overrideKey];
      if (override) {
        Object.assign(result, override);
      }
    }

    return result;
  }

  hasSection(name) {
    return name in this._sections;
  }
}
