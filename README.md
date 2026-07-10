# Schemify

Paste JSON, get TypeScript — then Zod, GraphQL, OpenAPI, SQL, mock data, and more.

The developer data transformation toolkit. One input, infinite outputs.

## Roadmap

- [x] JSON → TypeScript interfaces
- [ ] JSON → Zod schemas
- [ ] JSON → GraphQL types
- [ ] JSON → OpenAPI specs
- [ ] JSON → SQL schemas
- [ ] JSON → C# classes
- [ ] Mock data generation from schemas
- [ ] API diff viewer (v1 vs v2)
- [ ] Schema comparison
- [ ] Data anonymizer
- [x] Bulk batch processing (CLI)

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