# Schemify

Paste JSON, get TypeScript — then Zod, GraphQL, OpenAPI, SQL, mock data, and more.

The developer data transformation toolkit. One input, infinite outputs.

## Roadmap

- [x] JSON → TypeScript interfaces
- [ ] JSON → Zod schemas
- [ ] JSON → GraphQL types
- [x] JSON → OpenAPI 3.1 schemas
- [ ] JSON → SQL schemas
- [ ] JSON → C# classes
- [ ] Mock data generation from schemas
- [ ] API diff viewer (v1 vs v2)
- [ ] Schema comparison
- [ ] Data anonymizer
- [x] Bulk batch processing (CLI)
- [x] Web UI playground

## Web UI

A browser playground: paste JSON on the left, pick an output format, and see the
generated code on the right.

```sh
npm run dev      # start the dev server
npm run build    # type-check and bundle to dist/
npm run preview  # serve the production build
```

The interface is a thin DOM layer over a framework-agnostic core
(`src/transformers/playground.ts`), so the paste → transform → render logic is
fully unit-tested without a browser and can back other front-ends too.

## CLI

Read JSON from files, URLs, or stdin and generate one or more formats:

```sh
schemify user.json                    # TypeScript to stdout
schemify -f ts,zod user.json          # multiple formats
cat user.json | schemify --format zod # from stdin
schemify -u https://api.example.com/user.json -f zod
schemify -f ts,zod -o generated a.json b.json  # batch, write to a directory
```

Run `schemify --help` for the full list of options, or `schemify --list-formats`
to see the available output formats.