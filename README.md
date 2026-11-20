# Token Graph

A mod for [Claude Code](https://claude.com/claude-code) that shows how much each chat costs and tells you when to compact or start a new chat.

```
✻ This chat: 2.4M tokens · 31.5k written · $3.10 spent so far · each message re-reads 96k (10%) · compacted 1×   [Compact] [New chat] [Graph]
```

## What it does

- **One line above the message box, in every chat.** It shows:
  - the tokens this chat has used
  - what it has cost so far
  - how much context each new message re-reads
  - how many times the chat has been compacted
- **Compact** runs `/compact`.
  - It is gray when the chat is small (under 60k), because compacting would save almost nothing.
  - It lights up, with a one-time reminder, once each message re-reads 150k or more.
- **New chat** lights up once a chat has been compacted twice and is past 150k again. A third summary would lose too much detail.
  - Press it and Claude writes a `HANDOFF.md`: the goal, where things stand, what was learned, and your preferences.
  - Claude then gives you one message to paste into the new chat.
- **Graph** (or `/tokens`) opens a panel with:
  - a running total
  - the new tokens of each response
  - how full the context window is

Everything is read from the chat's own transcript on your computer. The mod sends nothing anywhere.

## Install

Send Claude Code this message:

> Install the Claude Code mod from github.com/danielhagever/token-graph for every chat.

Or run these yourself:

```bash
claude plugin marketplace add danielhagever/token-graph
claude plugin install token-graph@my-mods --scope user
```

Then restart Claude Code.

## Update

```bash
claude plugin marketplace update my-mods
claude plugin update token-graph@my-mods
```

## Notes

- Very long chats (transcripts over 4 MB) are read through a small `perl` script. perl comes with macOS and Linux. On Windows, those chats may show 0 tokens.
- The dollar figure comes from Claude Code itself. It is what the chat has spent so far, so compacting does not lower it.

## License

MIT
