# Nuxeo Satori, for the agent

What an AI IDE's agent needs to configure Nuxeo Satori in this repository, versioned with the
`@nuxeo/satori-cli` that carries it. Every check `satori validate` makes is this version's, and
so is everything here. Read it from `node_modules/@nuxeo/satori-cli/knowledge/`, or through the
MCP server's `read_reference` tool, which lists and reads these files and the examples.

| File                                  | What it answers                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [files.md](files.md)                  | Every file a configuration package holds, what it does, which tool writes it, and its schema        |
| [recipes.md](recipes.md)              | What to do for each kind of request, step by step, with the tools to call                           |
| [payers.md](payers.md)                | A worked example from an empty package: a health payer's members, claims and cases                  |
| [branding.md](branding.md)            | The title, the themes and their colours, the logo, and what the app shows                           |
| [theme-tokens.md](theme-tokens.md)    | The colour tokens the application reads, and what each changes (written from the tool's own checks) |
| [registered.md](registered.md)        | Every id the platform registers: widgets, rules, computations, and what Layer 1 can hide or rename  |
| [../examples/](../examples/README.md) | Read-only apps Nuxeo builds and tests the platform with: worked examples, never installed           |

## The rules that hold everywhere

- **One package holds all of the customer's configuration**, in `config-packages/<name>/`: Layer
  0 (`bootstrap.json`, branding), Layer 1 (`manifest.json`, what the app shows), and their app
  definition (`app.json` and the files beside it).
- **Write through the MCP write tools only.** Each keeps a change only when the package then
  passes `satori validate`'s steps; anything else is refused and the package is left as it was.
- **Configuration only.** Types, schemas, page providers, workflows, vocabularies and Automation
  chains are the server's, from Nuxeo Studio. The one exception is a stand-in model for a demo or
  a prototype, on the person's yes ([recipes.md](recipes.md), "A stand-in model").
- **Registered ids only.** A widget, a rule, a computation or an operation must be registered
  ([registered.md](registered.md)) or the package's own; anything else is refused.
- **Hiding is not security.** Nuxeo's permissions still decide who reads and changes what.
- **A person installs, pushes and releases.** You validate and build, and say what is theirs.
