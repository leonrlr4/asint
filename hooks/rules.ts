// What asint tells the agent: the system prompt rules, the questions the prompt-bar buttons ask, and the checklist tool's schema.
// Plain text and data; register.tsx sends them.

import { SYSTEM_MAPS } from './archdir'

export const OUTPUT_RULE = `# Keep deliverables in the terminal

Write plans, specs, reports, analyses, drafts, tables and diagrams as Markdown in your reply so the terminal shows them. Do not create Claude Docs documents.

When something needs to be a web page: write the .html to a file and publish it with the Artifact tool as usual (private). asint opens the local file in a browser next to the terminal (terminal-browser) and lists it under WEB in the dashboard's MEDIA panel, so your reply only needs the Artifact link and the local path, not a text copy. For pages that need trackpad zoom the user opens them with \`/html -b <path>\` in the system browser.`

export const CHECKLIST_RULE = `# Checklist

For any task with three or more steps, call mcp__asint__checklist before the first step, send the full list on every call, mark one item in_progress while you work on it and completed as soon as it is done.`

export const DOCS_DENY = 'asint: the user wants deliverables written in the reply (shown in the terminal), not as Claude Docs documents. Write it as Markdown in your reply instead.'

/** The diagram rule for a project with .c4 files at `paths`; `likec4` is how the agent should call the CLI. */
export const archRule = (paths: string[], likec4: string) => `# Architecture diagrams

This project keeps LikeC4 architecture models in ${paths.join(', ')}. The user watches them live in the asint ARCH panel, which re-renders a few seconds after a file is saved.${paths.some(p => p.includes(`/${SYSTEM_MAPS}/`)) ? ` Files under ${SYSTEM_MAPS} are the system layer (all projects of the workspace, with \`metadata { repo '...' }\` pointing at each repo); the docs/ files are the repo layer.` : ''}

You decide whether a change you make alters the architecture. It does when you add, remove or rename a module or service, add or drop an external dependency (an API, database, CLI, or a file the system reads or writes), or change how parts talk to each other. Pure refactors, bug fixes inside one module, tests and docs do not.

When it does, update the repo-layer .c4 in the same turn; when the change touches how systems talk to each other or to outside services (APIs, storage, auth, queues), update the system layer too. Keep existing element ids stable, follow each file's existing language for labels, and check with \`${likec4} validate <dir>\`. Never commit these files on your own.`

// The "Plain" button sends its question through /btw, a side question that stays out of the main conversation and doesn't interrupt a running turn.
export const PLAIN_ASK = 'Explain what your previous reply said and did, in the language I write in, at a level a programming beginner can follow. Avoid jargon; when a term is unavoidable, explain it.'

// What the "Arch diagram" button (and /asint arch) asks the main conversation: the agent checks for a
// diagram itself, creates one if there is none, and brings an existing one in line with the code.
export const archInitAsk = (likec4: string) => `Check this project's LikeC4 architecture diagrams: create what is missing, update what is out of date.

1. Find them: inside a git repo, look for docs/*.c4 at the repo root, and look upward for a workspace system layer at */02-Architecture/system-maps/*.c4. In a workspace folder that is not a repo itself, the system layer is the starting point and every git repo below it is part of the job.
2. Repo layer: every repo needs its own docs/architecture.c4 at container level: the units that run, data stores and queues, external services, and who calls it. Read the repo first (AGENTS.md, CLAUDE.md, README, entry points, Dockerfiles and deploy config, dependency manifests, .env.example) and back every element with a file you read. In a workspace, go into each repo and create the ones that are missing; do not stop at the top level.
3. System layer (workspaces with several repos): one element per repo, or per system grouping several repos, and each repo element carries metadata { repo '<path from the .c4 folder to the repo>' } so the diagram can be opened into that repo's own diagram. In repo diagrams, an element that stands for another repo of the same workspace carries the same metadata, so readers can move sideways. Make sure every repo path you write resolves to a folder that now has docs/*.c4.
4. Diagrams that already exist: compare them with the code, add what is missing and correct what is stale, keeping element ids stable.
5. Write labels in each project's own language (English unless the project is clearly written in another one). Check every folder you touched with \`${likec4} validate <dir>\`, do not commit, and finish with a short list of what you created or changed per folder.`

// This Claude Code version has no TodoWrite/TaskCreate, so the agent can't make a checklist; asint provides one.
// isDeferred: false keeps it out of tool search; a deferred tool is never loaded unless the agent searches for it.
export const CHECKLIST_SPEC = {
  name: 'checklist',
  isDeferred: false,
  description: 'Show a step checklist in the asint dashboard so the user can follow progress. Send the FULL list every call; mark an item in_progress when you start it and completed as soon as it is done.',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'What the step is' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string', description: 'Present-continuous form shown while in progress' },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
}
