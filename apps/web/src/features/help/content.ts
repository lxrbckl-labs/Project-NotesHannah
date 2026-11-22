/**
 * The words of the guide. Edit text here; the components only lay it out.
 *
 * Inline marks inside any string: **bold** and `keys` (shown as a keyboard key).
 * After editing, run `pnpm guide:pdf` so the downloadable PDF matches. The figures are screenshots
 * of the app (`pnpm guide:figures`, see tools/guide-figures.mjs); their sizes are in figures.json.
 * Spelling is American throughout (Alex, 2026-11-17): practice, organized, favorites, color.
 */
import { guideRow, hotkeyGuideBlocks } from "../hotkeys/guide";
import FIGURE_SIZES from "./figures.json";

export type FigureId = keyof typeof FIGURE_SIZES;

export interface GuideTable {
  kind: "table";
  head: string[];
  rows: string[][];
  caption?: string;
  keys?: boolean;
}

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | GuideTable
  | {
      kind: "note";
      tone: "tip" | "limit";
      title?: string;
      text: string;
    }
  | { kind: "figure"; id: FigureId };

export interface GuideSection {
  id: string;
  title: string;
  /** One line under the title. */
  lead: string;
  blocks: GuideBlock[];
}

export interface Showcase {
  title: string;
  what: string;
  why: string;
}

export interface GuidePart {
  id: string;
  /** "Part one" and so on. */
  label: string;
  title: string;
  lead: string;
  /** Section ids, in reading order. */
  sections: string[];
}

export interface GuideFigure {
  src: string;
  width: number;
  height: number;
  /** What the picture shows, for screen readers. */
  alt: string;
  caption: string;
  /** A phone screenshot is tall and narrow, so it is set smaller. */
  shape?: "phone" | "square" | "short" | "compact";
}

export const GUIDE_TITLE = "Guide";
export const GUIDE_HEADING = "Your guide to Notes";
export const GUIDE_SUBTITLE = "Everything in the app, in the order you are likely to need it.";
export const GUIDE_BYLINE = "Built for you, by Alex.";
export const GUIDE_PDF_PATH = "/guide/notes-guide.pdf";
export const GUIDE_PDF_NAME = "Notes-guide.pdf";

export const INTRO = [
  "This guide walks through everything in the app, in the order you are likely to need it. You do not have to read it in one go. Each section stands on its own, and the list of sections is always one tap away.",
  "If you only read one part, read Finals: divide and conquer. It explains how to split a pile of exams into pieces and hand the heavy lifting to an assistant.",
];

export const SHOWCASE_TITLE = "What makes this different";
export const SHOWCASE_LEAD =
  "These are the things the app does that an ordinary notes app does not. Each one is built and working today.";

export const SHOWCASE: Showcase[] = [
  {
    title: "Every claim shows its source",
    what: "Each block an assistant writes in a study guide, and each practice question, points to the slide or page it came from. Tap the numbered chip and the original page opens with the passage highlighted.",
    why: "You can check a fact in seconds. Anything that is not from your material says so: it carries a “Not from your notes” label.",
  },
  {
    title: "Handwriting becomes searchable text",
    what: "Photos of handwritten notes are transcribed page by page and filed beside your slides. Search looks through those transcripts as well as your typed notes.",
    why: "Your own handwriting turns up when you search for “beta blockers”, even though you never typed it.",
  },
  {
    title: "Sixteen kinds of note block",
    what: "Drug cards, comparison tables, mnemonics, mind maps, labeled images with tappable points, callouts, checklists, tables and practice questions sit alongside plain paragraphs.",
    why: "A lecture does not have to be a wall of text. The right shape for the material is one tap away.",
  },
  {
    title: "A canvas for every lecture",
    what: "Any document can be viewed as cards, arrows and frames on a dotted grid. You can step through the frames one at a time. Anything you move stays where you put it.",
    why: "It is a way to see how a topic fits together, and a guided review the night before an exam.",
  },
  {
    title: "A map of your drugs and concepts",
    what: "Every drug and concept has its own page that gathers everything about it from all your courses. A small graph shows what it connects to. There is a brand and generic drill and a side by side compare.",
    why: "Lopressor and metoprolol are one thing in your notes, not two entries to look up.",
  },
  {
    title: "Practice you cannot peek at",
    what: "Multiple choice, select all, matching, fill in the blank, calculations, flashcards, cases and free response. The app marks the objective ones itself, and the answer key does not reach your device until you have answered.",
    why: "When you get it right, you actually knew it. Flashcards come back just before you would forget them.",
  },
  {
    title: "Exams with a countdown",
    what: "Add an exam with its date and the lectures it covers. The home screen shows the days left and how many of that exam’s practice questions you have worked through, and practice can be limited to that exam.",
    why: "Several finals stop being one big pile and become a list of small ones.",
  },
  {
    title: "Ask for anything, anywhere",
    what: "Leave a request on a course, a lecture or a single block: “make 20 questions on this”, “this is wrong”, “explain this more simply”. An assistant picks it up and answers on the request itself.",
    why: "You decide what you need. The assistant does the writing, and shows its sources.",
  },
  {
    title: "Your work is protected",
    what: "A block you wrote or edited, a block you marked as reviewed, and a canvas card you pinned are not overwritten by an assistant. The one exception is when you ask it, in a request, to change that exact thing.",
    why: "You can let an assistant loose on a course and know your own notes will still be there afterward.",
  },
  {
    title: "Nothing is lost by accident",
    what: "Every saved change to a document is kept in its version history and can be restored. Deleted items go to a trash you can restore from. Your original uploads are stored once and never altered.",
    why: "You can experiment freely, because nothing you do is hard to undo.",
  },
  {
    title: "Private by design",
    what: "There is no sign-up page: accounts are made by Alex, and your notes are kept apart from anyone else’s. The pages ask search engines to stay away. The app itself holds no AI key. Assistants use a separate key that you can see and revoke in Settings.",
    why: "It is your study space, not a product. It does not show ads and it does not try to keep you here.",
  },
];

/** Tables shared by a section and the quick reference card. */
export const TYPING_SHORTCUTS: GuideTable = {
  kind: "table",
  keys: true,
  head: ["Type", "You get"],
  rows: [
    ["`# `", "A large heading"],
    ["`## `", "A medium heading"],
    ["`### `", "A small heading"],
    ["`- `", "A bulleted list"],
    ["`1. `", "A numbered list"],
    ["`[] `", "A checklist you can tick off"],
    ["`> `", "A quote"],
    ["`!! `", "A warning callout"],
    ["`?? `", "A tip callout"],
    ["`---` then `Enter`", "A divider line"],
  ],
};

export const FORMATTING_MARKS: GuideTable = {
  kind: "table",
  keys: true,
  head: ["Type", "You get"],
  rows: [
    ["`**words**`", "Bold"],
    ["`*words*`", "Italic"],
    ["A backtick on each side of the words", "Code"],
    ["`~~words~~`", "Strikethrough"],
    ["`==words==`", "Highlight"],
  ],
};

/**
 * The keys worth keeping on the quick reference card. Written from the hotkey registry
 * (features/hotkeys/registry.ts), like the full list in the Keyboard shortcuts section.
 */
export const COMPUTER_KEYS: GuideTable = {
  kind: "table",
  keys: true,
  head: ["Keys", "What they do (computer)"],
  rows: [
    "app.shortcuts",
    "app.quickFind",
    "app.sidebar",
    "go.library",
    "app.ask",
    "tree.rename",
    "tree.trash",
    "doc.mode",
    "doc.sideNote",
    "doc.outline",
  ].map(guideRow),
};

export const SECTIONS: GuideSection[] = [
  {
    id: "what-this-is",
    title: "What this is, and how your library is organized",
    lead: "Notes keeps your slides, your handwriting and your own writing in one place, and helps you study from them.",
    blocks: [
      {
        kind: "p",
        text: "You upload your lecture slides, PDFs and photos of handwritten notes. The app keeps the originals untouched. An AI assistant can read them, turn them into text, file them where they belong and write study guides and practice questions that point back to the page they came from. You can read, edit and add to everything.",
      },
      {
        kind: "p",
        text: "The app itself does no thinking and holds no AI key. It stores, organizes and displays. The assistants work from outside, when you run one for yourself, and everything they write is marked so you can check it.",
      },
      { kind: "h3", text: "The shape of your library" },
      {
        kind: "p",
        text: "Your library is a tree, and it always has the same shape, so you always know where to look.",
      },
      {
        kind: "table",
        head: ["Level", "What it is", "Example"],
        rows: [
          ["Term", "A semester or block of study.", "Fall 2026"],
          ["Course", "One class. Each course gets its own color.", "Pharmacology II"],
          [
            "Section",
            "Five fixed shelves in every course: Sources, Lectures, Study guides, Practice, Exams. They cannot be renamed or moved.",
            "Lectures",
          ],
          [
            "Folder",
            "Optional grouping inside a section. Folders can sit inside folders, as deep as you like.",
            "Cardiovascular",
          ],
          [
            "Lecture",
            "One class session. Your slides, handwriting and the study guide for it all hang from here.",
            "07 · Beta blockers",
          ],
          [
            "Document",
            "A page of writing. A lecture has a main page, and you can start more documents of your own under it.",
            "Exam 3 cram sheet",
          ],
        ],
      },
      {
        kind: "p",
        text: "On a computer or tablet the sidebar shows this tree and you can open it up level by level. On a phone, Library is the first tab at the bottom. The library home is the whole tree on one page, including your uploaded files, and it remembers which rows you had open when you come back to it.",
      },
      { kind: "figure", id: "library-home" },
      {
        kind: "p",
        text: "To add something, open the place it belongs and use the New button: New term, New course, New folder, New lecture or New document. You can rename or move anything from the “…” menu beside it. On a computer you can also drag it.",
      },
    ],
  },
  {
    id: "finals",
    title: "Finals: divide and conquer",
    lead: "How to split a pile of exams into small pieces, and let assistants do the heavy lifting.",
    blocks: [
      {
        kind: "p",
        text: "This app was built around one idea. A finals week is too much for one person to summarize, quiz and review alone, so the work is divided. You decide what matters and when. Assistants do the reading and writing. You check it and practice.",
      },
      { kind: "h3", text: "What an assistant is here" },
      {
        kind: "p",
        text: "An assistant (the app calls it an agent) is an AI such as Claude Code or Codex that works inside your library on your behalf. It reads your slides and handwritten notes, turns them into text, files them under the right lecture, and writes study guides, practice questions, concept maps and canvases. It also answers the requests you leave.",
      },
      {
        kind: "p",
        text: "You are never asked to trust it blindly. Everything it writes points to the exact page it came from, and stays marked **to review** until you check it and mark it reviewed.",
      },
      { kind: "h3", text: "An example: three finals in ten days" },
      {
        kind: "p",
        text: "Say you have Pharmacotherapy I on day 3, a calculations final on day 6, and a cumulative Pharmacology II final on day 10.",
      },
      {
        kind: "list",
        items: [
          "**Divide.** Add each final as an exam, with its date and the lectures or folders it covers. The home screen now shows three countdowns and how many practice questions you have worked through for each.",
          "**Delegate.** Leave requests where the need is. On the Pharmacology II course: “write a cumulative study guide for the final”. On a lecture: “make 20 questions on this”. On a single block: “explain this more simply” or “this is wrong”. Different assistants can work on different courses at the same time, and your reviewed blocks and pinned canvas cards stay as they are.",
          "**Conquer.** Practice one exam at a time. Work through the missed questions notebook, run the flashcards, drill brand and generic names, and use the canvas step-through the night before.",
        ],
      },
      {
        kind: "note",
        tone: "limit",
        title: "Not instant",
        text: "A request is answered when an assistant session is run for you, not at the moment you leave it. It waits in the Requests screen until then.",
      },
      { kind: "h3", text: "What each tool is for" },
      {
        kind: "table",
        head: ["You want to", "Use", "Where"],
        rows: [
          [
            "See how long you have and what is covered",
            "Exams and the countdown",
            "Library home, and Practice, then Exams",
          ],
          [
            "Get something written or fixed",
            "A request",
            "The Ask button on any course, lecture, document or block",
          ],
          [
            "Test yourself on one exam",
            "A practice session limited to that exam",
            "Practice, or “Practice this”",
          ],
          [
            "Catch up on what you got wrong",
            "The missed questions notebook",
            "Practice, then Notebook",
          ],
          ["Keep facts fresh", "Flashcards", "Practice, then Cards"],
          ["Learn brand and generic names", "The drill", "Concepts, then Drill"],
          [
            "Do a final read-through",
            "The canvas, stepped frame by frame",
            "A document, then Canvas",
          ],
        ],
      },
      { kind: "h3", text: "A rhythm for finals week" },
      {
        kind: "list",
        ordered: true,
        items: [
          "Two weeks out: upload anything missing, check the Inbox is empty, and add every exam with its date and coverage.",
          "Leave requests for what you need written, such as a cumulative guide for each course and questions on the lectures you find hardest. Run an assistant session so they are answered.",
          "Read what came back. Tap the source chips on anything that seems odd, fix or flag what is wrong, and mark blocks reviewed as you go.",
          "Each day, start a practice session limited to the next exam. Clear the missed questions notebook before you stop.",
          "Do the flashcards that are due, and a few minutes of the brand and generic drill.",
          "The night before, step through the canvas for that exam’s main lectures. Stop there and sleep.",
        ],
      },
      {
        kind: "note",
        tone: "limit",
        title: "Honest limits",
        text: "An exam covers material inside one course. There is no one tap “build a cumulative guide” yet. A cumulative guide is written by you, or by an assistant when you ask for it in a request. A block cannot yet be reused inside another document, so a cumulative guide is written out rather than assembled.",
      },
    ],
  },
  {
    id: "getting-material-in",
    title: "Getting your material in",
    lead: "Upload once. The app does the rest of the tidying, with an assistant’s help.",
    blocks: [
      {
        kind: "p",
        text: "You can upload PDFs, PowerPoint slides (.pptx or the older .ppt), Word handouts (.docx or .doc), OpenDocument slides and documents (.odp and .odt), and pictures in JPEG, PNG, HEIC, WebP, GIF, TIFF, AVIF or BMP format. HEIC is what an iPhone or iPad camera makes, so photos of handwritten notes work straight from the camera or photo library. A TIFF with several pages becomes several pages, and an animated GIF shows only its first frame. You can choose several files at once. On a computer you can also drag files onto a page.",
      },
      {
        kind: "list",
        items: [
          "On the Inbox page, use Upload files. The file waits there until it is filed.",
          "Or open a lecture, folder or Sources section and use Upload files there. The file goes straight in.",
        ],
      },
      { kind: "h3", text: "What the labels mean" },
      {
        kind: "table",
        head: ["Label", "What it means"],
        rows: [
          ["Queued", "Saved, not yet sent for conversion."],
          ["Converting", "The app is turning the file into page images."],
          [
            "Ready",
            "The pages are ready to read, and the file is waiting for an assistant to transcribe it.",
          ],
          [
            "Transcribed",
            "Every page now has its text. For handwriting this is the assistant’s reading of it, so glance over it. Next step: file it under a lecture or folder.",
          ],
          ["Filed", "Transcribed and put in your library."],
          [
            "Failed",
            "The file could not be read. The message says why, for example a password on the PDF. Fix it and upload again, or press Retry.",
          ],
        ],
      },
      {
        kind: "p",
        text: "Use the “…” menu on a file to File under…, rename it, send it back to the Inbox, or move it to the trash. A file filed under a lecture also shows in that lecture’s Source files.",
      },
      {
        kind: "note",
        tone: "tip",
        text: "Files with a password, files over 500 pages, and other file types (spreadsheets and SVG drawings, for example) are refused with a message that says what to do. Export those as a PDF and upload that.",
      },
      { kind: "h3", text: "Dragging" },
      {
        kind: "list",
        items: [
          "**Drop files to upload:** on a computer, drag files from your desktop onto the library home or the Inbox and they go to the inbox. Drag them onto a lecture, a folder or a Sources page and they are filed there. The whole window shows where they will go.",
          "**Move things by dragging:** drag a folder, lecture or document onto a folder to put it inside. Drag a source file onto a folder or lecture to file it there. This works in the page and in the sidebar’s list of terms and courses.",
          "**Drag something out of a folder:** drop it on a place in the line of names at the top of the page (Library, the term, the course, the section), and it moves up to that place.",
          "**Folders inside folders:** as deep as you like.",
        ],
      },
    ],
  },
  {
    id: "reading-a-lecture",
    title: "Reading a lecture",
    lead: "A lecture page is where the study guide for that lecture lives.",
    blocks: [
      {
        kind: "p",
        text: "Open a lecture from the library and choose Open the page. You will see the study guide as a page of blocks: headings, paragraphs, tables, drug cards and so on. The outline lets you jump between headings. The page for a lecture such as Beta blockers is built from your slides and notes for that day.",
      },
      {
        kind: "p",
        text: "Beside the page there can be two sidebars, with the Outline, your Resources and your Side notes in them. They follow you as you scroll: the outline marks the section you are in, and Resources lights up the sources of the part you are reading. The next section but one, Side notes and the sidebars, has the details.",
      },
      { kind: "figure", id: "lecture-page" },
      { kind: "h3", text: "Source chips" },
      {
        kind: "p",
        text: "Numbers on a block are source chips. Tap one and the original page opens beside the document, with the passage that supports the claim highlighted. A block built from several sources lists each one. If a source has been moved to the trash, the chip says so instead of breaking. At the end of the document, a Sources list shows everything cited.",
      },
      { kind: "figure", id: "source-page" },
      {
        kind: "p",
        text: "A block marked **Not from your notes** was written from general knowledge, not from your slides. Treat it as a suggestion and check it.",
      },
      { kind: "h3", text: "To review marks" },
      {
        kind: "p",
        text: "Anything an assistant wrote is marked as not yet reviewed. When you have read a block and are happy with it, use Mark as reviewed from its menu. A reviewed block shows as reviewed by you, and assistants leave it alone from then on. Your own writing is reviewed from the start.",
      },
      {
        kind: "list",
        items: [
          "If a block is wrong or unclear, use Ask about this block and choose This is wrong or This is unclear.",
          "To get practice questions from a block, choose Make questions from this.",
        ],
      },
    ],
  },
  {
    id: "writing-your-own-notes",
    title: "Writing your own notes",
    lead: "Your words sit beside the study guide and are never overwritten.",
    blocks: [
      { kind: "h3", text: "Starting a note" },
      {
        kind: "p",
        text: "Open a lecture, such as Beta blockers, and under Your notes choose Start a note, or use New document. A blank page opens ready to type. Documents can also be started inside a folder or section, for something like an Exam 3 cram sheet.",
      },
      { kind: "h3", text: "The “/” menu" },
      {
        kind: "p",
        text: "On an empty line, type `/` to open a list of everything you can add. Keep typing to narrow it down, then press `Enter`. On a phone it opens as a list you tap. The “+” beside a block does the same thing.",
      },
      { kind: "h3", text: "Typing shortcuts" },
      {
        kind: "p",
        text: "At the start of a line, type these and the line changes shape.",
      },
      TYPING_SHORTCUTS,
      {
        kind: "p",
        text: "Each shortcut needs the space after it, except the divider. In a list, `Enter` makes the next item.",
      },
      { kind: "h3", text: "The kinds of block" },
      {
        kind: "table",
        head: ["Block", "What it is good for"],
        rows: [
          ["Heading, Paragraph", "Titles and ordinary writing."],
          ["Bulleted list, Numbered list", "Points, or steps in order."],
          ["Checklist", "Things to do or to learn, which you tick off."],
          ["Quote", "A line from a lecturer or a guideline."],
          ["Divider", "A break between parts of a page."],
          ["Table", "Doses, schedules, anything in rows and columns."],
          ["Image", "A picture, such as a photo of a diagram."],
          ["Callout", "A warning or a tip that should stand out."],
          [
            "Drug card",
            "One drug on one card: class, mechanism, uses, adverse effects, interactions and counseling points.",
          ],
          [
            "Comparison table",
            "Several drugs side by side, built from your concepts, such as atenolol, metoprolol and propranolol.",
          ],
          ["Mnemonic", "A memory aid, with what each letter stands for."],
          [
            "Labeled image",
            "A picture with points you can tap to read a label, such as β1 and β2 receptors.",
          ],
          ["Mind map", "A topic broken into branches, such as the types of beta blocker."],
          ["Practice question", "A question that lands in Practice as well as on the page."],
        ],
      },
      { kind: "h3", text: "Undo and version history" },
      {
        kind: "p",
        text: "Undo and redo are at the left of the toolbar, and `Ctrl` or `⌘` with `Z` does the same. For anything bigger, Version history lists every saved change. Pick one to see what the document looked like, and restore it. Restoring does not throw anything away: the version you were on stays in the history too.",
      },
      { kind: "h3", text: "The toolbar" },
      {
        kind: "p",
        text: "While you are editing, a toolbar sits across the top of the page, much like a word processor. Tap into any text and it lights up to show what is there: the kind of line you are on, and whether the text is bold, italic or highlighted. Tapping a button never moves your place in the text.",
      },
      { kind: "figure", id: "editor" },
      {
        kind: "table",
        head: ["Part of the toolbar", "What it does"],
        rows: [
          ["Undo and redo", "Step back or forward through your changes."],
          [
            "Style menu",
            "Shows what the current line is (Text, Heading 1 to 3, Quote, Bulleted list, Numbered list, Checklist or Callout) and changes it when you pick another.",
          ],
          [
            "Bold, italic, underline, strikethrough, code",
            "Format the selected words, or what you type next.",
          ],
          [
            "Highlight, block color, link",
            "Highlight words in a color, color a whole block, or turn words into a link.",
          ],
          ["Lists, indent and outdent", "Start a list, and move a list line in or out a level."],
          [
            "Insert",
            "Add a table, callout, divider or any other kind of block where your cursor is.",
          ],
          ["Keyboard button", "A reminder of every typing shortcut and key combination."],
        ],
      },
      {
        kind: "p",
        text: "On a narrower screen the less used buttons fold into a More menu. On a phone the same tools sit in a bar just above the keyboard, and it scrolls sideways. On a computer, selecting text also shows a small bar right beside the selection.",
      },
      { kind: "h3", text: "Formatting as you type" },
      {
        kind: "p",
        text: "You can also format without leaving the keyboard. Wrap words in these marks and they change as you finish typing.",
      },
      FORMATTING_MARKS,
      {
        kind: "note",
        tone: "limit",
        title: "Not there yet",
        text: "You cannot change the font, the text size or the alignment, and a color applies to a whole block, not to single words. Highlighting works on single words.",
      },
    ],
  },
  {
    id: "side-notes",
    title: "Side notes and the sidebars",
    lead: "Notes to yourself in the margin, and the panels that follow you down the page.",
    blocks: [
      {
        kind: "p",
        text: "A side note is a note to yourself, written beside a part of a page, much like a comment in a word processor. It sits level with the block it is about and moves with it as you scroll. Side notes are kept apart from the page itself, so you can write them on a study guide an assistant wrote without changing it, without touching what you have reviewed, and without adding to its version history.",
      },
      { kind: "h3", text: "Writing one" },
      {
        kind: "list",
        items: [
          "Point at a block on a computer, or scroll it to the middle of the screen on an iPad or phone, and tap the small note button at its right edge.",
          "Or choose Add a side note from the block’s menu while editing.",
          "Or press `⌘⌥M` (`Ctrl+Alt+M` on Windows) while you are writing in the block.",
          "Or use the + at the top of the Side notes panel: the note goes on the part of the page you are reading.",
        ],
      },
      { kind: "figure", id: "side-notes" },
      {
        kind: "p",
        text: "If you select some words in the block and then press `⌘⌥M`, those words are kept with the note, so you know exactly what it was about. Notes are plain text, and line breaks are kept. Pick a color if you like, then Add note. `⌘` or `Ctrl` with `Enter` saves, and `Escape` cancels.",
      },
      { kind: "h3", text: "Working with your notes" },
      {
        kind: "p",
        text: "A block with notes shows a small marker with how many there are; tap it to open them. Tap a note to look at it: it lines up exactly with its block, the others move out of its way, and its buttons appear. Mark it as done when it no longer needs you (done notes tuck away under Done, at the foot of the panel), change it, or delete it. Deleting shows an Undo for a few seconds.",
      },
      {
        kind: "p",
        text: "If the block a note was on is deleted, or an assistant replaces the part of the guide it was on, the note is not lost. It moves to Detached, still showing the words it was on. Scroll to where it belongs and choose Attach here, or delete it. A note follows its block when the block is moved.",
      },
      { kind: "h3", text: "Resources" },
      {
        kind: "p",
        text: "The Resources panel lists the sources and outside references of the page, grouped by section. The section you are reading is open, and the entries for the blocks on screen are highlighted. Tap an entry to jump to its block. The button at its end opens the source: the slide beside the page, or the outside page in a new tab. Point at a block and its entries light up; point at an entry and its block does.",
      },
      { kind: "h3", text: "Arranging the sidebars" },
      {
        kind: "p",
        text: "Drag a panel by the grip at the left of its title into the other sidebar, or above or below another panel. Tap the grip instead for Move to the other sidebar, Move up, Move down and Close panel. Tap a panel’s title to fold it. The Panels button in the bar at the top shows or hides each sidebar and brings back a closed panel, and drag a sidebar’s inner edge to make it wider. Your arrangement is remembered on each device, once for all your documents.",
      },
      {
        kind: "table",
        head: ["Screen", "How the panels start"],
        rows: [
          ["Computer", "The outline on the left; side notes and resources on the right."],
          [
            "iPad, held sideways",
            "Side notes on the right. The outline waits on the left: tap the outline button to show it.",
          ],
          [
            "iPad, held upright",
            "Both sidebars open over the page, one at a time, so the page keeps its width.",
          ],
          [
            "Phone",
            "No sidebars. The outline button opens a sheet with three tabs: Outline, Resources and Notes. A note marker opens it at that note.",
          ],
        ],
      },
      {
        kind: "p",
        text: "When there is not room for a sidebar beside the page, it waits folded away and opens over the page when you ask for it, so the page never gets too narrow to read.",
      },
      {
        kind: "note",
        tone: "tip",
        title: "Assistants can read them",
        text: "Your side notes are yours: an assistant cannot write, change or delete them. It can read them, though, so a note such as “I don’t get why selectivity fades” tells it where to explain more the next time it works on that guide.",
      },
      {
        kind: "note",
        tone: "limit",
        title: "Not there yet",
        text: "Side notes do not show on the canvas, and a copy of a document starts without them.",
      },
    ],
  },
  {
    id: "canvas",
    title: "The canvas",
    lead: "The same document, drawn as a map.",
    blocks: [
      {
        kind: "p",
        text: "Any lecture or document can be viewed as a canvas as well as a page. At the top of the document, switch between Page and Canvas. It is the same content either way. Changing a block changes it in both.",
      },
      { kind: "figure", id: "canvas" },
      {
        kind: "list",
        items: [
          "**Cards** hold the blocks. **Arrows** join them, and can carry a label such as “causes” or “blocks”. **Frames** group cards, for example one frame for cardioselective and one for non-selective beta blockers.",
          "The cards are laid out automatically. If you drag a card somewhere, it stays there, even when an assistant rearranges everything else. Use Release to automatic layout if you want the tidy version back.",
          "Add your own cards, arrows and frames, and edit or delete any of them. You can add stickers too.",
          "Pan by dragging the background. Zoom with a pinch, the scroll wheel or the zoom buttons. Use the whole map button to see everything at once.",
          "**Step through frames** takes you one frame at a time, zooming in on each. It works well as a guided review the night before an exam. Use Exit step-through to go back.",
        ],
      },
      {
        kind: "note",
        tone: "limit",
        text: "The canvas has not yet been tried on a real iPad. If a gesture feels wrong there, tell Alex.",
      },
    ],
  },
  {
    id: "concepts",
    title: "Concepts: drugs and classes",
    lead: "One page for each drug or idea, gathered from all your courses.",
    blocks: [
      {
        kind: "p",
        text: "Open Concepts in the sidebar. Browse lists every drug and class in your notes. Each has a page that gathers what you know about it, with links back to the lectures and questions where it appears. Search by name, alias or brand, so Lopressor finds metoprolol.",
      },
      {
        kind: "list",
        items: [
          "**The small graph** shows a drug or class with what it connects to: its class, targets, uses and adverse effects. Tap a neighbor to move across to it. You can filter by the kinds of connection.",
          "**Ask a question** finds everything with a given feature, such as every drug with a particular adverse effect.",
          "**Compare** puts two or more drugs side by side.",
          "**Drill** is the brand and generic drill: it shows a name and you match it to its partner. Drugs you get wrong come back around.",
        ],
      },
      { kind: "figure", id: "concept" },
      {
        kind: "p",
        text: "Concepts that an assistant added are marked unverified until you review them. The Concepts item in the sidebar shows how many are waiting.",
      },
    ],
  },
  {
    id: "practice",
    title: "Practice",
    lead: "Test yourself, and let the app remember what you missed.",
    blocks: [
      {
        kind: "p",
        text: "Practice is the second tab on a phone and an item in the sidebar on a larger screen. Choose what to work on (a course, a lecture, a folder, a concept or an exam), which kinds of question, and how many. Then start. You can also press Practice this on any lecture, folder or course.",
      },
      { kind: "figure", id: "practice-question" },
      { kind: "h3", text: "Question types" },
      {
        kind: "table",
        head: ["Type", "How it works"],
        rows: [
          ["Multiple choice", "One right answer out of several."],
          ["Select all", "One or more right answers. All of them, and nothing else."],
          ["Matching", "Pair things up, such as brand names with generics, or drugs with classes."],
          ["Fill in the blank", "Type the missing words."],
          [
            "Calculation",
            "A dosing or conversion problem. Type the number with its unit. Some come with different numbers each time, and the worked answer is shown after.",
          ],
          ["Flashcard", "Flip it, then say how well you knew it."],
          ["Case", "A short patient story with questions that follow from it."],
          ["Free response", "Write your answer, then tick the key points you covered."],
        ],
      },
      {
        kind: "p",
        text: "The app marks multiple choice, select all, matching, fill in the blank and calculation questions for you. For flashcards, free response and cases, you mark yourself. Every question shows an explanation and a link to its source after you answer. A question you did not answer is left out of your results.",
      },
      { kind: "h3", text: "Sessions" },
      {
        kind: "p",
        text: "If you leave a session, your place is saved. Pick up where you left off from the start screen. When you finish, the results show how you did by topic and by type of question.",
      },
      { kind: "h3", text: "The missed questions notebook" },
      {
        kind: "p",
        text: "Every question you get wrong goes into the Notebook automatically. Answer it correctly and it leaves. A calculation has to be right twice in a row before it leaves, because one right answer can be luck.",
      },
      { kind: "h3", text: "Flashcards" },
      {
        kind: "p",
        text: "The Cards tab shows how many cards are due today. A card comes back just before you would forget it, so a missed day does not pile up into a debt.",
      },
      { kind: "h3", text: "Weak areas" },
      {
        kind: "p",
        text: "Weak areas groups your results by topic and shows where you are going well and what needs another look.",
      },
      { kind: "h3", text: "Focus aids" },
      {
        kind: "p",
        text: "While answering, the sliders button beside Pause opens the focus aids. Each one is off until you turn it on, and your choices stay on for every session on that device. They change how a question looks, never what is asked or how it is marked.",
      },
      {
        kind: "list",
        items: [
          "**Text size:** normal, large or larger, for the question and its answers.",
          "**Extra spacing:** more room between letters, words and lines.",
          "**Reading ruler:** a clear band follows your pointer or finger and dims the lines above and below.",
          "**Just the question:** hides the question count and the progress bar.",
          "**Read the question aloud:** your device reads the question in its own voice. Press again to stop.",
          "There is no timer on screen. Pause stops the clock and hides the question until you resume.",
        ],
      },
    ],
  },
  {
    id: "exams",
    title: "Exams",
    lead: "Tell the app what is coming and what it covers.",
    blocks: [
      {
        kind: "list",
        items: [
          "Open Practice, then Exams, and choose Add an exam. Give it a title, the course, the date, and choose the lectures or folders it covers. An example is “Exam 3”, in Pharmacology II, covering lectures 5 to 9.",
          "Your next exams appear on the library home with the days remaining and your progress: how many of its practice questions you have practiced, how many are in your notebook, and how many cards are due.",
          "To work on one exam, press Practice for this exam. The session draws only from what it covers. The notebook and flashcards can be limited the same way.",
          "Change coverage on an exam at any time. Deleting an exam does not delete your notes, questions or answers.",
        ],
      },
      {
        kind: "note",
        tone: "limit",
        text: "An exam covers lectures and folders inside one course. If a final spans two courses, add one exam for each.",
      },
    ],
  },
  {
    id: "calendar",
    title: "Calendar",
    lead: "Your exams on their dates, and the days you studied.",
    blocks: [
      {
        kind: "list",
        items: [
          "Open Calendar from the sidebar, or from the tabs at the bottom on a phone. The month shows every exam on its date. Add or change an exam under Practice, then Exams, and it appears here.",
          "A day you studied is tinted, darker the more you did, and marked with a small pen. Studying means answering practice questions or writing in your own notes. What an assistant writes for you is not counted.",
          "Pick a day to see what you did: how many questions you answered, how many were right, about how long it took, which lectures they came from, and which notes you wrote in. Each one is a link.",
          "The top of the page shows your next exam, how many days in a row you have studied, and how many days you studied in the month on screen. Coming up lists the exams in the next two months; pick one to jump to its date.",
        ],
      },
      {
        kind: "note",
        tone: "limit",
        text: "The calendar shows exams and study days only. Lecture dates, reminders and study plans for future days are not on it yet.",
      },
    ],
  },
  {
    id: "references",
    title: "References",
    lead: "Outside guidelines and tools you trust, tied to what you are studying.",
    blocks: [
      {
        kind: "p",
        text: "Your notes are built from your slides and your own notes. Trusted references such as PharmGuides are used to check and extend them, and anything that comes from a reference is labeled. It shows as its own small chip, like “PharmGuides · DoseDex”, apart from the numbered chips that open your slides, so you can always tell what came from class and what came from outside.",
      },
      { kind: "h3", text: "The References page" },
      {
        kind: "list",
        items: [
          "Open References from the sidebar. On a phone, use the References button on the library home, or the row in Settings.",
          "PharmGuides sits at the top. Search it from here, or jump straight to its guideline index, AntibioticDex, DoseDex, TNKalc or Pharmacy Notes. It opens in a new tab.",
          "Below it is your own list. Choose **Save a reference**, paste an address, give it a title and a note, and say what kind it is: a guideline, a calculator, a chart or an article.",
          "Tie a reference to the courses, folders or lectures it belongs with. It then shows on those pages, under References, with Add a reference here beside it.",
        ],
      },
      { kind: "h3", text: "In your notes" },
      {
        kind: "list",
        items: [
          "To mark a block yourself, open its menu and choose **Add a reference**. Pick one you saved or paste an address.",
          "A document’s list of sources has a separate group, Outside references, and each saved reference shows where it is used.",
          "Every drug and concept page has a Look up on PharmGuides link.",
          "Search finds your saved references, and offers to search PharmGuides for the same words.",
        ],
      },
      {
        kind: "note",
        tone: "tip",
        title: "How assistants use them",
        text: "An assistant writing your study guide starts from your slides, then checks the matching reference. Where the two disagree it keeps what your slide says and tells you. It links to a reference and never pastes long passages from one.",
      },
      {
        kind: "note",
        tone: "limit",
        text: "The app links to outside sites and does not keep copies of their pages. A reference is a starting point: check the primary guideline before relying on it.",
      },
    ],
  },
  {
    id: "asking-for-help",
    title: "Asking for help",
    lead: "Leave a request and an assistant will pick it up.",
    blocks: [
      {
        kind: "p",
        text: "When something in your notes is wrong, unclear or missing, leave a request. Use the Ask button on a course, lecture, document, source page or concept, or the Ask about this block option on a single block. Write it the way you would say it: “quiz me on beta blockers”, “this card is wrong”, “explain this more”. On a block there are quick choices for the common cases: This is wrong, This is unclear, and Make questions from this.",
      },
      { kind: "h3", text: "Your own instructions" },
      {
        kind: "p",
        text: "If you always want something built the same way, write it down once. In Settings, under Instructions for agents, choose New instruction, give it a name such as “Lecture notes”, and write how you want it done: one section per slide, bold every drug name, a table for anything compared, five questions at the end. You can change or delete an instruction there at any time.",
      },
      {
        kind: "p",
        text: "When you ask an agent, pick one from the Instructions list in the request. It travels with the request and the assistant follows it. With an instruction chosen you do not have to type anything else. The request keeps its own copy, so changing the instruction later does not change what an older request asked for.",
      },
      {
        kind: "p",
        text: "Your requests are listed on the Requests screen: the sidebar on a larger screen, or Settings on a phone.",
      },
      {
        kind: "table",
        head: ["Status", "What it means"],
        rows: [
          ["Waiting for an agent", "Saved. An assistant will pick it up the next time one runs."],
          [
            "An agent is working on it",
            "Someone is on it right now. The page refreshes by itself.",
          ],
          [
            "Done",
            "The assistant answered, with a note of what changed and links to the result. Not what you wanted? Reopen it with a follow-up.",
          ],
          [
            "Needs a change",
            "The assistant could not do it as asked. Read why, then reopen it with more detail.",
          ],
          ["Canceled", "You withdrew it."],
        ],
      },
      { kind: "figure", id: "requests" },
      {
        kind: "note",
        tone: "limit",
        title: "Not instant",
        text: "A request is answered when an assistant session is run for you. It is not answered the moment you leave it. The badge on Requests tells you how many are waiting.",
      },
      {
        kind: "p",
        text: "The Activity screen lists what assistants have done in your library, so nothing happens out of sight.",
      },
    ],
  },
  {
    id: "finding-and-keeping",
    title: "Search, favorites and the trash",
    lead: "Finding things again, keeping them close, and getting them back.",
    blocks: [
      {
        kind: "list",
        items: [
          "**Quick find** opens from the search bar at the top of a larger screen, or with `Ctrl+K` or `⌘K`. With a keyboard, `/` does the same, and `G` then `/` opens Search. It jumps to courses, lectures, folders and documents by name.",
          "**Search** (a tab on a phone) searches inside everything: your typed notes, study guides, practice questions, and the transcripts of your slides and handwriting. Each result shows where it was found.",
          "**Favorites**: tap the star on any item to keep it close.",
          "**Trash**: moving something to the trash does not delete it. Open Trash (in the sidebar, or in Settings on a phone) and restore it, and it goes back where it came from. Only deleting from inside the trash is permanent.",
        ],
      },
    ],
  },
  {
    id: "settings-and-devices",
    title: "Appearance, signing in and devices",
    lead: "How the app looks, how you sign in, and how it fits each device.",
    blocks: [
      { kind: "figure", id: "phone" },
      {
        kind: "list",
        items: [
          "**Light and dark:** Settings, then Appearance. Follow your device, or choose light or dark.",
          "**Your tab bar:** on a phone, Settings, then Tab bar, shows a copy of the bar along the bottom. Drag the icons into the order you want, for example Settings at the far left, and press Save. The real bar changes when you save, and the order is kept for your account on every device. If you would rather not drag, tap an icon and use Move left and Move right, or the arrow keys. Reset puts the usual order back.",
          "**Signing in:** you stay signed in on each device until you sign out. After several wrong passwords the app slows down further attempts.",
          "**Change your password:** Settings, then Password. It needs at least 10 characters, and it signs your other devices out.",
          "**Sign out everywhere** ends every session on every device, including the one you are using.",
          "**Devices:** the app has three layouts. A phone shows one page at a time with tabs at the bottom. A tablet adds a sidebar. A computer adds a details panel in the library and small badges that show each button’s key. With a keyboard, a tablet and a computer both answer to keyboard shortcuts: they are all in Keyboard shortcuts, the next section.",
        ],
      },
      {
        kind: "p",
        text: "The Settings page also holds the keys that let an assistant into your library. You can create one, name it, make it read only or read and write, and revoke it at any time.",
      },
      { kind: "h3", text: "Making it yours" },
      {
        kind: "list",
        items: [
          "**Your own background:** Settings, then Background. Choose any picture, of any size, and it replaces the dots behind every page on every device you sign in on. Remove puts the dots back.",
          "**Sidebars:** drag the inner edge of any sidebar to make it wider or narrower; double-click the edge to go back to the usual width. Each sidebar’s button closes it, and the same button in the top bar opens it again.",
          "**Calendar tab:** the phone’s tab bar has six tabs, Calendar among them. Reorder them under Tab bar.",
          "**The tour:** the first time you sign in, a short tour walks you through each part of the app. Skip, at the bottom right, ends it at any point. To take it again, press Take the tour at the top of this guide in the app.",
          "**Read or Edit:** every lecture and document page has a Read and Edit switch in its bar. Read is for studying: nothing can be changed by accident, and the formatting bar is out of the way. Edit is for writing. The app remembers which one you last chose on that device.",
          "**Panel heights:** where two panels share a sidebar on a lecture page, drag the line between them to give one more room. Side notes stay level with the text they are about. Double-click the line to go back to the usual split.",
        ],
      },
    ],
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    lead: "Every key the app answers to, on a computer or a tablet with a keyboard.",
    blocks: [
      {
        kind: "p",
        text: "Press `?` on any screen to see every shortcut over the page you are on. The list there and the tables below are the same list, so a key in one is always in the other.",
      },
      {
        kind: "list",
        items: [
          "**Pairs:** keys written as two letters, such as `G L`, are pressed one after the other. Press `G`, let go, then `L` within a second, and the Library opens.",
          "**Badges:** on a computer, a small badge at the edge of a button shows its key, and a button that is only an icon shows its key when you point at it. To hide the badges, open Settings, then Keyboard shortcuts, and turn off Show keyboard shortcut badges. The keys keep working.",
          "**Only where it makes sense:** a key works only on the screen that has its button. `P` practices the item you have open on a library page, and on a source file it goes back a page.",
          "**Never while you type:** single keys and pairs do nothing while you are typing in a box or writing on a page, and while a dialog or a menu is open. Keys with `⌘` or `Ctrl` work everywhere.",
          "**Writing keys:** bold, headings, lists and the rest are on the Keyboard button in a page’s toolbar, and on the quick reference at the end of this guide.",
          "**Phones:** a phone has no keyboard shortcuts.",
        ],
      },
      ...hotkeyGuideBlocks(),
    ],
  },
  {
    id: "good-to-know",
    title: "Good to know",
    lead: "The things that are not finished, so they do not surprise you.",
    blocks: [
      {
        kind: "list",
        items: [
          "Requests are answered when an assistant session is run for you, not instantly.",
          "Transcription of handwriting can misread small details, for example a dose written as `q8h`. Check transcribed handwriting before you rely on it, especially numbers.",
          "There is no one tap way to build a study guide from several lectures yet. Ask for it in a request.",
          "A block cannot be reused in another document.",
          "An exam covers one course.",
          "Concepts cannot be filtered by course yet.",
          "The “to review” count in the sidebar counts concepts only, not blocks inside documents.",
          "A wide table can run past the edge of the page on a narrow screen. Scroll sideways on it if it does.",
          "On the canvas, a card dragged out of a frame stays pinned where you dropped it, and dragging a card into a frame can be unreliable on tablet and computer.",
          "On a tablet the row of Practice tabs can run off the right edge. Scroll it sideways.",
          "The app cannot yet be installed to the home screen, and it needs a connection to work. There is no offline mode.",
          "The app has not yet been tried on a real iPad or iPhone. If something feels off there, tell Alex.",
          "You cannot download all of your data from the app yet.",
          "A course’s color is chosen by the app. You cannot pick it yet.",
        ],
      },
    ],
  },
];

/** The four parts the sections are grouped into. Every section is in exactly one part. */
export const PARTS: GuidePart[] = [
  {
    id: "part-start-here",
    label: "Part one",
    title: "Start here",
    lead: "What the app is, how your library is laid out, and the one idea it was built around.",
    sections: ["what-this-is", "finals"],
  },
  {
    id: "part-your-material",
    label: "Part two",
    title: "Your material",
    lead: "Getting your slides and notes in, reading a lecture, writing notes of your own, and notes in the margin.",
    sections: ["getting-material-in", "reading-a-lecture", "writing-your-own-notes", "side-notes"],
  },
  {
    id: "part-study-tools",
    label: "Part three",
    title: "Study tools",
    lead: "The canvas, concepts, practice, exams and references: five ways to learn from what is in your library.",
    sections: ["canvas", "concepts", "practice", "exams", "calendar", "references"],
  },
  {
    id: "part-help-and-housekeeping",
    label: "Part four",
    title: "Help and housekeeping",
    lead: "Asking for help, finding things again, your settings, and what is not finished yet.",
    sections: [
      "asking-for-help",
      "finding-and-keeping",
      "settings-and-devices",
      "keyboard-shortcuts",
      "good-to-know",
    ],
  },
];

const figure = (
  id: FigureId,
  rest: Omit<GuideFigure, "src" | "width" | "height">,
): GuideFigure => ({
  src: `/guide/figures/${id}.webp`,
  ...FIGURE_SIZES[id],
  ...rest,
});

/** The pictures of the app, each used once. Numbered in reading order. */
export const FIGURES: Record<FigureId, GuideFigure> = {
  "library-home": figure("library-home", {
    alt: "The library home on a computer: the sidebar, the tree of terms and courses, and the upcoming exams with their days left and progress bars.",
    caption:
      "The library home: your whole library as one tree, with your next exams, the days left and your progress below it.",
  }),
  "lecture-page": figure("lecture-page", {
    alt: "The Beta blockers lecture page, with numbered source chips under a paragraph, a side note level with it on the right, and the Resources panel below the notes.",
    caption:
      "A lecture page. The numbered chips under a block are its sources; on the right, your side notes and the resources of the part you are reading.",
  }),
  "side-notes": figure("side-notes", {
    alt: "A side note about labetalol, open beside the mnemonic block it is about, with its done, change and delete buttons; the Resources panel below it lists the slides of the Classification section.",
    caption:
      "A side note, level with the block it is about. Tap a note to see its buttons: done, change and delete.",
  }),
  "source-page": figure("source-page", {
    alt: "A source chip opened beside the document: the original slide, and its transcript with the cited words highlighted.",
    caption:
      "Tap a source chip and the original slide opens beside the document, with the passage that supports the claim highlighted.",
  }),
  editor: figure("editor", {
    alt: "A note being edited: the toolbar across the top and the style menu open, listing Text, three headings, Quote, lists, Checklist and Callout with their typing shortcuts.",
    caption:
      "Writing a note. The toolbar sits across the top, and the style menu shows the kind of line you are on, with the typing shortcut for each style.",
  }),
  canvas: figure("canvas", {
    shape: "compact",
    alt: "The Beta blockers lecture as a canvas, stepping through its first frame, How they work, with cards joined by a labeled arrow.",
    caption:
      "The Beta blockers lecture drawn as a canvas, stepping through its frames one at a time.",
  }),
  concept: figure("concept", {
    shape: "square",
    alt: "The graph on the metoprolol tartrate page: its class, cardioselective beta blockers, the other drugs in that class, and CYP2D6 inhibition.",
    caption:
      "The small graph on a drug’s page: metoprolol tartrate, its class, the other drugs in that class, and an interaction.",
  }),
  "practice-question": figure("practice-question", {
    shape: "short",
    alt: "A multiple choice practice question about propranolol and hypoglycaemia, with four answers labeled A to D.",
    caption:
      "A multiple choice question in a practice session. The answer key does not reach your device until you have answered.",
  }),
  requests: figure("requests", {
    alt: "The Requests screen: the requests grouped by status on the left, and each request with the assistant’s reply on it.",
    caption:
      "The Requests screen: what you asked for, where it stands, and the assistant’s answer on the request itself.",
  }),
  phone: figure("phone", {
    shape: "phone",
    alt: "The Beta blockers lecture page on a phone, with source chips under a paragraph and the tabs along the bottom.",
    caption: "The same lecture on a phone: one page at a time, with the tabs along the bottom.",
  }),
};

export interface QuickReferenceGroup {
  title: string;
  /** A short line under the group title. */
  note?: string;
  rows: string[][];
}

export const QUICK_REFERENCE_ID = "quick-reference";
export const QUICK_REFERENCE_TITLE = "Quick reference";
export const QUICK_REFERENCE_LEAD =
  "Every typing shortcut, formatting mark and key combination on one card. Print it and keep it close.";

export const QUICK_REFERENCE: QuickReferenceGroup[] = [
  {
    title: "Start a line with",
    note: "Each needs the space after it, except the divider.",
    rows: TYPING_SHORTCUTS.rows,
  },
  {
    title: "Wrap words in",
    note: "The words change as you finish typing.",
    rows: FORMATTING_MARKS.rows,
  },
  {
    title: "While you write",
    rows: [
      ["`/`", "On an empty line: everything you can add"],
      ["`Enter`", "In a list: the next item"],
      ["`Ctrl` `Z` or `⌘` `Z`", "Undo"],
    ],
  },
  {
    title: "On a computer",
    rows: COMPUTER_KEYS.rows,
  },
];
