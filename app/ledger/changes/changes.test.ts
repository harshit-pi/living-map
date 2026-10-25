import { describe, expect, it } from "vitest";

import {
  applyHunks,
  composeFacts,
  extract,
  type Fact,
  fileKind,
  groupOf,
  hunkFacts,
  hunkShape,
  hunkSide,
  importSpecifiers,
  invertHunks,
  manifestFacts,
  parseAliases,
  resolveSpecifier,
  sourceFacts,
} from "./graph.ts";
import {
  attach,
  diffGraphs,
  explain,
  extensionOf,
  maskSecrets,
  noStructuralChange,
} from "./rules.ts";

const keys = (facts: Fact[] | null, kind?: string) =>
  (facts ?? []).filter((f) => !kind || f.kind === kind).map((f) => f.key);

describe("fileKind", () => {
  it("reads source, package.json and compose files", () => {
    expect(fileKind("app/server/engine.ts")).toBe("source");
    expect(fileKind("web/App.tsx")).toBe("source");
    expect(fileKind("lib/x.mjs")).toBe("source");
    expect(fileKind("app/package.json")).toBe("manifest");
    expect(fileKind("docker-compose.yml")).toBe("compose");
    expect(fileKind("deploy/compose.prod.yaml")).toBe("compose");
    expect(fileKind("docker-compose.override.yml")).toBe("compose");
  });

  it("does not read other kinds", () => {
    for (const p of [
      "README.md",
      "web/brand.css",
      "server/main.py",
      "types.d.ts",
      "package-lock.json",
      "tsconfig.json",
      "k8s/deploy.yaml",
      "infra/main.tf",
      ".env",
    ])
      expect(fileKind(p)).toBeNull();
  });
});

describe("groupOf", () => {
  it("folds a file to its first directory levels", () => {
    expect(groupOf("app/server/core/prompts.ts")).toBe("app/server");
    expect(groupOf("app/server/engine.ts")).toBe("app/server");
    expect(groupOf("src/index.ts")).toBe("src");
    expect(groupOf("index.ts")).toBe(".");
    expect(groupOf("a/b/c/d.ts", 3)).toBe("a/b/c");
  });
});

describe("importSpecifiers", () => {
  it("finds every form of import", () => {
    const src = `
      import fs from "node:fs";
      import type { Map } from "../shared/model.ts";
      import {
        a,
        b as c,
      } from './multi.ts';
      import "./side-effect.css";
      export * from "./all.ts";
      export { x } from "./named.ts";
      export * as ns from "./ns.ts";
      const r = require("lodash");
      const lazy = await import("./lazy.ts");
    `;
    expect(importSpecifiers(src).sort()).toEqual(
      [
        "node:fs",
        "../shared/model.ts",
        "./multi.ts",
        "./side-effect.css",
        "./all.ts",
        "./named.ts",
        "./ns.ts",
        "lodash",
        "./lazy.ts",
      ].sort(),
    );
  });

  it("ignores imports in comments, strings, templates and regexes", () => {
    const src = [
      `// import a from "./commented.ts";`,
      `/* import b from "./block.ts"; */`,
      `const s = "import c from './in-string.ts'";`,
      'const t = `import d from "./in-template.ts"`;',
      `const re = /"/g; import e from "./after-regex.ts";`,
      `obj.import("./method.ts");`,
      `const dyn = import(name);`,
    ].join("\n");
    expect(importSpecifiers(src)).toEqual(["./after-regex.ts"]);
  });
});

describe("resolveSpecifier", () => {
  const files = new Set([
    "app/layer/index.ts",
    "app/shared/model.ts",
    "app/server/engine.ts",
  ]);
  const exists = (p: string) => files.has(p);

  it("resolves relative imports to the group of the file they name", () => {
    expect(resolveSpecifier("app/server/x.ts", "../layer", { exists })).toEqual(
      { group: "app/layer" },
    );
    expect(resolveSpecifier("app/server/x.ts", "./engine.ts")).toEqual({
      group: "app/server",
    });
    expect(resolveSpecifier("x.ts", "../../elsewhere.ts")).toEqual({
      group: "(outside the repo)",
    });
  });

  it("names packages and builtins", () => {
    expect(resolveSpecifier("a/b.ts", "@xyflow/react/dist/style.css")).toEqual({
      pkg: "@xyflow/react",
    });
    expect(resolveSpecifier("a/b.ts", "react-dom/client")).toEqual({
      pkg: "react-dom",
    });
    expect(resolveSpecifier("a/b.ts", "fs/promises")).toEqual({
      pkg: "node:fs",
    });
    expect(resolveSpecifier("a/b.ts", "node:path")).toEqual({
      pkg: "node:path",
    });
    expect(resolveSpecifier("a/b.ts", "https://x.dev/m.js")).toBeNull();
  });

  it("uses tsconfig paths, scoped to their config's directory", () => {
    const aliases = parseAliases(
      `{
        // comments and trailing commas are fine
        "compilerOptions": { "paths": { "@shared/*": ["./shared/*"], }, },
      }`,
      "app/tsconfig.json",
    );
    expect(aliases).toEqual([
      {
        scope: "app",
        prefix: "@shared/",
        exact: false,
        targets: ["app/shared/"],
      },
    ]);
    expect(
      resolveSpecifier("app/web/App.tsx", "@shared/model.ts", { aliases }),
    ).toEqual({ group: "app/shared" });
    // outside the config's directory the alias does not apply
    expect(
      resolveSpecifier("other/x.ts", "@shared/model.ts", { aliases }),
    ).toEqual({ pkg: "@shared/model.ts" });
    // an unconfigured "@/" alias is internal, not a package
    expect(resolveSpecifier("src/a.ts", "@/components/x")).toEqual({
      group: "(alias @/)",
    });
  });

  it("reads baseUrl and exact aliases, and skips a bare '*'", () => {
    const aliases = parseAliases(
      JSON.stringify({
        compilerOptions: {
          baseUrl: "src",
          paths: { "@/*": ["*"], config: ["config/index.ts"], "*": ["*"] },
        },
      }),
      "tsconfig.json",
    );
    expect(aliases.map((a) => [a.prefix, a.exact, a.targets])).toEqual([
      ["@/", false, ["src/"]],
      ["config", true, ["src/config/index.ts"]],
    ]);
    expect(parseAliases("not json", "tsconfig.json")).toEqual([]);
  });
});

describe("sourceFacts", () => {
  it("emits the module and cross-group edges, not edges within a group", () => {
    const facts = sourceFacts(
      "app/server/engine.ts",
      `import a from "./store.ts"; import b from "../layer/view.ts"; import React from "react";`,
    );
    expect(keys(facts, "module")).toEqual(["app/server"]);
    expect(keys(facts, "import-edge").sort()).toEqual([
      "app/server → app/layer",
      "app/server → react",
    ]);
  });
});

describe("manifestFacts", () => {
  it("reads dependencies, scripts and engines", () => {
    const facts = manifestFacts(
      "app/package.json",
      JSON.stringify({
        dependencies: { express: "^5.1.0" },
        devDependencies: { vitest: "^3.0.0" },
        scripts: { test: "vitest run" },
        engines: { node: ">=23.6" },
      }),
    );
    expect(facts?.map((f) => [f.kind, f.key, f.value])).toEqual([
      ["dependency", "app/package.json#dependencies#express", "^5.1.0"],
      ["dependency", "app/package.json#devDependencies#vitest", "^3.0.0"],
      ["script", "app/package.json#script#test", "vitest run"],
      ["engine", "app/package.json#engine#node", ">=23.6"],
    ]);
  });

  it("gives null for a manifest it cannot parse", () => {
    expect(manifestFacts("package.json", '{ "name": ')).toBeNull();
    expect(manifestFacts("package.json", "[]")).toBeNull();
  });
});

describe("composeFacts", () => {
  const yml = `
version: "3.9"
x-common: &common
  restart: always
services:
  web:
    build:
      context: ./web   # the app
    ports:
      - "8080:80"
      - target: 443
        published: 8443
        protocol: tcp
    depends_on:
      - db
  db:
    image: postgres:16
    ports: ["127.0.0.1:5432:5432"]
  worker:
    image: "app/worker:latest"
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
networks:
  default: {}
`;

  it("reads services, images, ports and depends_on", () => {
    const facts = composeFacts("docker-compose.yml", yml);
    expect(
      facts?.filter((f) => f.kind === "service").map((f) => [f.text, f.value]),
    ).toEqual([
      ["service web (docker-compose.yml)", "build ./web"],
      ["web depends on db (docker-compose.yml)", undefined],
      ["service db (docker-compose.yml)", "image postgres:16"],
      ["service worker (docker-compose.yml)", "image app/worker:latest"],
      ["worker depends on db (docker-compose.yml)", undefined],
      ["worker depends on cache (docker-compose.yml)", undefined],
    ]);
    expect(keys(facts, "port")).toEqual([
      "docker-compose.yml#port#web#8080:80",
      "docker-compose.yml#port#web#8443:443",
      "docker-compose.yml#port#db#127.0.0.1:5432:5432",
    ]);
  });

  it("gives none without services and null for flow-style services", () => {
    expect(composeFacts("compose.yml", "volumes:\n  data: {}\n")).toEqual([]);
    expect(composeFacts("compose.yml", "services: { web: {} }\n")).toBeNull();
  });
});

describe("extract", () => {
  it("dispatches by kind and gives null for kinds it cannot read", () => {
    expect(extract("a/b.ts", `import x from "y";`)).not.toBeNull();
    expect(extract("package.json", "{}")).toEqual([]);
    expect(extract("README.md", "# hi")).toBeNull();
    expect(extract("main.py", "import os")).toBeNull();
    expect(extract("styles.css", "@import 'x.css';")).toBeNull();
  });
});

describe("hunkFacts", () => {
  it("reads import edges on each side of a source hunk", () => {
    const h = hunkFacts("app/server/a.ts", [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          ' import x from "../layer/x.ts";',
          '-import y from "../web/y.ts";',
          '+import z from "zod";',
        ],
      },
    ]);
    expect(keys(h?.before ?? [])).toEqual([
      "app/server → app/layer",
      "app/server → app/web",
    ]);
    expect(keys(h?.after ?? [])).toEqual([
      "app/server → app/layer",
      "app/server → zod",
    ]);
  });

  it("reads dependency lines in a manifest hunk", () => {
    const h = hunkFacts("package.json", [
      {
        oldStart: 5,
        oldLines: 3,
        newStart: 5,
        newLines: 4,
        lines: [
          '   "dependencies": {',
          '-    "express": "^4.0.0",',
          '+    "express": "^5.0.0",',
          '+    "zod": "^3.0.0",',
          "   },",
        ],
      },
      {
        oldStart: 20,
        oldLines: 1,
        newStart: 21,
        newLines: 1,
        lines: ['-    "lodash": "4.17.21"', '+    "test": "vitest run"'],
      },
    ]);
    expect(h?.before.map((f) => [f.key, f.value])).toEqual([
      ["package.json#dependencies#express", "^4.0.0"],
      ["package.json#dependencies?#lodash", "4.17.21"],
    ]);
    expect(h?.after.map((f) => [f.key, f.value])).toEqual([
      ["package.json#dependencies#express", "^5.0.0"],
      ["package.json#dependencies#zod", "^3.0.0"],
    ]);
  });

  it("gives null for compose and unreadable kinds", () => {
    expect(hunkFacts("docker-compose.yml", [])).toBeNull();
    expect(hunkFacts("notes.md", [])).toBeNull();
  });
});

describe("applyHunks", () => {
  const text = ["a", "b", "c", "d", "e"].join("\n");

  it("applies hunks at their place", () => {
    expect(
      applyHunks(text, [
        {
          oldStart: 2,
          oldLines: 2,
          newStart: 2,
          newLines: 2,
          lines: [" b", "-c", "+C"],
        },
      ]),
    ).toBe("a\nb\nC\nd\ne");
  });

  it("finds a hunk that moved, and refuses one that is not there", () => {
    const moved = {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [" d", "+d2"],
    };
    expect(applyHunks(text, [moved])).toBe("a\nb\nc\nd\nd2\ne");
    expect(applyHunks(text, [{ ...moved, lines: [" zz", "+x"] }])).toBeNull();
  });
});

describe("invertHunks, hunkShape and hunkSide", () => {
  it("steps a file back by undoing its hunks", () => {
    const hunks = [
      {
        oldStart: 2,
        oldLines: 2,
        newStart: 2,
        newLines: 3,
        lines: [" b", "-c", "+C", "+C2"],
      },
    ];
    const after = applyHunks("a\nb\nc\nd", hunks);
    expect(after).toBe("a\nb\nC\nC2\nd");
    expect(applyHunks(after ?? "", invertHunks(hunks))).toBe("a\nb\nc\nd");
    // a file changed since then does not step back
    expect(applyHunks("a\nb\nX\nd", invertHunks(hunks))).toBeNull();
  });

  it("tells a whole file appearing or going, and its text", () => {
    const create = [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        lines: ["+x", "+y"],
      },
    ];
    const remove = invertHunks(create);
    expect(hunkShape(create)).toBe("create");
    expect(hunkShape(remove)).toBe("delete");
    expect(hunkShape([{ ...create[0], oldStart: 3, oldLines: 1 }])).toBeNull();
    expect(hunkSide(create, "+")).toBe("x\ny");
    expect(hunkSide(remove, "-")).toBe("x\ny");
  });
});

const f = (
  kind: Fact["kind"],
  key: string,
  file: string,
  value?: string,
): Fact => ({ kind, key, text: `${kind} ${key}`, value, file });

describe("diffGraphs", () => {
  it("says added, removed and changed", () => {
    const before = [
      f("dependency", "pkg#dependencies#express", "package.json", "^4"),
      f("dependency", "pkg#dependencies#lodash", "package.json", "4"),
    ];
    const after = [
      f("dependency", "pkg#dependencies#express", "package.json", "^5"),
      f("dependency", "pkg#dependencies#zod", "package.json", "^3"),
    ];
    expect(diffGraphs(before, after).map((s) => s.text)).toEqual([
      "added dependency pkg#dependencies#zod: ^3",
      "changed dependency pkg#dependencies#express: ^4 → ^5",
      "removed dependency pkg#dependencies#lodash",
    ]);
  });

  it("folds edges across files: one file dropping an edge another keeps is no change", () => {
    const before = [
      f("import-edge", "app/server → app/layer", "app/server/a.ts"),
      f("import-edge", "app/server → app/layer", "app/server/b.ts"),
    ];
    const after = [
      f("import-edge", "app/server → app/layer", "app/server/b.ts"),
    ];
    expect(diffGraphs(before, after)).toEqual([]);
    const gone = diffGraphs(before, []);
    expect(gone.map((s) => [s.op, s.kind, s.files])).toEqual([
      ["removed", "import-edge", ["app/server/a.ts", "app/server/b.ts"]],
    ]);
  });

  it("covers modules, services, ports, scripts and engines", () => {
    const before = [
      f("module", "app/old", "app/old/x.ts"),
      f("service", "c.yml#service#db", "c.yml", "image postgres:15"),
      f("script", "p#script#dev", "p", "vite"),
      f("engine", "p#engine#node", "p", ">=20"),
    ];
    const after = [
      f("module", "app/ledger", "app/ledger/x.ts"),
      f("service", "c.yml#service#db", "c.yml", "image postgres:16"),
      f("port", "c.yml#port#db#5432:5432", "c.yml"),
      f("engine", "p#engine#node", "p", ">=23.6"),
    ];
    expect(diffGraphs(before, after).map((s) => `${s.op} ${s.kind}`)).toEqual([
      "added module",
      "removed module",
      "changed engine",
      "removed script",
      "changed service",
      "added port",
    ]);
  });

  it("names only the files whose value changed", () => {
    const before = [
      f("service", "k", "a.yml", "image x:1"),
      f("service", "k", "b.yml", "image x:1"),
    ];
    const after = [
      f("service", "k", "a.yml", "image x:1"),
      f("service", "k", "b.yml", "image x:2"),
    ];
    expect(diffGraphs(before, after)[0].files).toEqual(["b.yml"]);
  });
});

describe("evidence", () => {
  it("attaches the tool call and lets a net statement borrow it", () => {
    const call = attach(
      diffGraphs([], [f("dependency", "p#dependencies#zod", "p", "^3")]),
      { turn: 4, toolUseId: "toolu_1", tool: "Edit" },
    );
    expect(call[0].evidence).toEqual([
      { file: "p", turn: 4, toolUseId: "toolu_1", tool: "Edit" },
    ]);
    const net = diffGraphs(
      [],
      [
        f("dependency", "p#dependencies#zod", "p", "^3"),
        f("module", "unexplained", "u/x.ts"),
      ],
    );
    const explained = explain(net, call);
    expect(explained.map((s) => s.evidence)).toEqual([
      [{ file: "u/x.ts" }],
      [{ file: "p", turn: 4, toolUseId: "toolu_1", tool: "Edit" }],
    ]);
  });
});

describe("noStructuralChange", () => {
  const ts = { path: "app/server/a.ts", readable: true, reconstructed: true };

  it("may be said when every changed file was read and rebuilt", () => {
    expect(noStructuralChange([], [ts])).toEqual({
      allowed: true,
      reason: "No structural change: 1 file edited",
    });
    expect(noStructuralChange([], []).allowed).toBe(true);
  });

  it("may not be said with a statement, an unreadable kind, a gap or an unseen write", () => {
    const st = diffGraphs([], [f("module", "m", "m/x.ts")]);
    expect(noStructuralChange(st, [ts]).allowed).toBe(false);
    const v = noStructuralChange(
      [],
      [
        ts,
        { path: "README.md", readable: false, reconstructed: false },
        { path: "docs/a.md", readable: false, reconstructed: false },
        { path: "web/brand.css", readable: false, reconstructed: false },
      ],
    );
    expect(v).toEqual({
      allowed: false,
      reason: "3 changed files are of kinds no extractor reads (.md ×2, .css)",
    });
    expect(
      noStructuralChange([], [{ ...ts, reconstructed: false }]).reason,
    ).toBe("1 readable file could not be rebuilt in full");
    expect(noStructuralChange([], [ts], 2).reason).toBe(
      "2 Bash commands may have written files without a diff",
    );
  });
});

describe("maskSecrets and extensionOf", () => {
  it("masks values that look like secrets and keeps ordinary text", () => {
    expect(maskSecrets("API_KEY=abc123 node server.js")).toBe(
      "API_KEY=*** node server.js",
    );
    expect(
      maskSecrets("curl -H token: ghp_abcdefghijklmnopqrstuvwxyz0123"),
    ).toBe("curl -H token: ***");
    expect(maskSecrets("postgres://user:hunter2@db:5432/app")).toBe(
      "postgres://user:***@db:5432/app",
    );
    expect(maskSecrets("vitest run app/server/providers/claude-sessions")).toBe(
      "vitest run app/server/providers/claude-sessions",
    );
    expect(maskSecrets("deploy a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6")).toBe(
      "deploy ***",
    );
  });

  it("names a file's kind by its extension", () => {
    expect(extensionOf("docs/README.MD")).toBe(".md");
    expect(extensionOf("Dockerfile")).toBe("Dockerfile");
    expect(extensionOf(".env")).toBe(".env");
  });
});
