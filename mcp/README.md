# Stack Radar MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the Stack Radar company directory as
tools, so an assistant can answer "which companies are hiring React engineers in Estonia?" from live
data instead of guessing or scraping the rendered site.

Transport: **stdio**. SDK: **`@modelcontextprotocol/sdk` 1.30.x**, using `McpServer` +
`registerTool` + `StdioServerTransport`.

## Tools

| Tool | Use it when | Returns |
| --- | --- | --- |
| `search_companies(query?, filters?, limit?)` | The user is looking for *companies* — by technology, product area, market or location. | Ranked companies, each with a 0–100 `score` and the `matchReasons` behind it. Omit `query` to browse by filters alone. |
| `get_company(id)` | You already have a company id and need the full record. | Everything: size, HQ, remote regions, every current opening with detected keywords, and the weekly open-role history. |
| `list_open_positions(filters?, limit?)` | The user is looking for *roles*, not companies. | Every open role across the whole dataset, flattened, each annotated with its company's id, name, website, country and remote policy. |

`filters` accepts `country`, `remote` (`remote` \| `hybrid` \| `onsite`), `minSize`, `maxSize`, and —
for `list_open_positions` — `keyword`. A filter that needs a field a record does not have excludes
that record rather than guessing at it.

### Data freshness — stated in every tool description and every response

Stack Radar is community-researched, not an official feed, and it is not a live job board. Each
record carries a `lastVerified` timestamp; **`lastVerified: null` means that record has never been
checked against the company's own careers page**, and a large share of the dataset is in that state.
`country`, `remotePolicy` and the size bounds are `null` wherever research could not establish them.
Every response carries a `note` restating this, so a model that reads only the payload still sees it.

## Install

Requires Node.js 20 or newer.

```bash
cd mcp
npm install
npm run build      # bundles src/ + the shared scoring/filtering modules into dist/index.js
```

`npm run typecheck` type-checks without emitting.

## Add it to Claude Code

```bash
claude mcp add stack-radar -e STACK_RADAR_API=https://stackradar.strukt.app -- node /absolute/path/to/stackradar/mcp/dist/index.js
```

Or commit it to the project by putting this in `.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "stack-radar": {
      "command": "node",
      "args": ["/absolute/path/to/stackradar/mcp/dist/index.js"],
      "env": {
        "STACK_RADAR_API": "https://stackradar.strukt.app"
      }
    }
  }
}
```

## Add it to Claude Desktop

Edit `claude_desktop_config.json` — on macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`, on Windows
`%APPDATA%\Claude\claude_desktop_config.json` — and add:

```json
{
  "mcpServers": {
    "stack-radar": {
      "command": "node",
      "args": ["/absolute/path/to/stackradar/mcp/dist/index.js"],
      "env": {
        "STACK_RADAR_API": "https://stackradar.strukt.app"
      }
    }
  }
}
```

Restart Claude Desktop afterwards. Use absolute paths in both clients — the server is launched
without a predictable working directory.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `STACK_RADAR_API` | `https://stackradar.strukt.app` | Base URL of the JSON API. Point it at `http://localhost:3000` to develop against `vercel dev`. Trailing slashes are trimmed. |

The variable is optional; with nothing set, the server talks to the production deployment.

## How it gets its data

Each tool call goes to the HTTP API first (`/api/search`, `/api/companies/{id}`, `/api/positions`,
`/api/companies`), with an 8-second timeout. If the API is unreachable, times out, returns a 5xx or
returns a payload that fails validation, the server **falls back to a snapshot of
`data/companies.json` bundled into `dist/index.js` at build time**, and says so: every response
includes `"source": "api"` or `"source": "snapshot"`.

The fallback is not a second implementation. It imports the very same filtering and shaping modules
the serverless functions use (`api/_lib/*`), which in turn call the single shared relevance scorer in
`src/lib/scoring.ts` — the same one the website uses. Both paths therefore produce identical record
shapes and identical rankings; only freshness differs.

Because the snapshot is bundled at build time, it is only as current as the last `npm run build`. Rerun
the build after the dataset changes if you rely on the offline path. A genuine 404 from a reachable
API is treated as authoritative — `get_company` reports "no such company" rather than falling back.

Diagnostics (fallbacks, transport errors) are written to **stderr**; stdout carries only JSON-RPC.

## Input handling

Tool inputs are validated with the same rules as the HTTP API: free text is capped at 120 characters
and `country` at 80 (over that is a validation error, not a silent truncation), `remote` must be one
of the three policies, size bounds must be non-negative integers, and `limit` is clamped to 1–50 with
a default of 10 rather than being rejected. No user input is ever compiled into a regular expression
or passed to anything evaluated — matching is plain substring comparison inside the shared scorer.

Responses are trimmed for token budget: `search_companies` and `list_open_positions` return compact
rows (descriptions truncated, keyword and role-title lists capped) while `get_company` returns the
full record, because that is the reason to call it.
