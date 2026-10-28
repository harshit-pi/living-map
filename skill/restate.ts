// What the chat is told to do with something from the map: say it back in
// its own reply, in the user's words. The listener's output and the hook's
// note reach Claude outside the chat's transcript (Claude Code lets no
// local tool add a user turn), so a resumed chat, a handover written from
// the transcript, or the map's own next read would never see the answer;
// one line at the top of Claude's reply puts it there.
export const RESTATE =
  'Begin your reply with one line that says this back in the user\'s words, quoted, starting "From your map:" (for example: From your map: you answered "Which store?" with "Postgres"). What reaches you from the map is not part of this chat\'s transcript; that line is, so the decision stays in the chat for later.';

// what the listener prints when the map has something for the chat
export const fromMap = (text: string) =>
  `FROM YOUR LIVING MAP:\n${text}\n\n${RESTATE}`;

// the note the hook adds to the user's next message
export const mapNote = (text: string, port: number) =>
  `LIVING MAP: the user keeps a live map of this conversation at http://localhost:${port}/, with side chats that know everything said here. Since your last turn there:\n${text}\nTake this into account where it bears on the user's message; they may refer to it. ${RESTATE}`;
