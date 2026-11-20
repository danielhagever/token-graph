/** What the New chat button sends Claude: get everything ready for a fresh chat to pick up. */
export const HANDOFF_PROMPT = `This chat is getting too long, so I'm moving to a new chat. Before I do, get everything ready for the move:

1. Write a handoff file, HANDOFF.md in this project's folder (update it if one is already there), that a new chat can start from with no other context. Include:
   - The goal: what we're working on and why.
   - Where it stands: what is done, verified, still open or broken, and the exact next step.
   - What we've learned: decisions and the reasons for them, things we tried that didn't work, gotchas, and the commands, files and paths that matter.
   - My preferences and working style as you've seen them in this chat.
2. Save any lasting preference or rule from this chat that your memory doesn't have yet.
3. End your reply with the file's path and one short message I can paste into the new chat to pick up from there.`
