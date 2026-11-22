/**
 * The tour: a short walk through each part of the app. Each stop goes to a page, puts a spotlight on
 * one thing there and says what it is for, in a sentence or two.
 *
 * `target` is a list of CSS selectors, tried in order; the first one that is on screen is lit. A link
 * in the navigation is found by where it goes (`a[href="/practice"]`), in the sidebar on a tablet or
 * computer and in the tab bar on a phone, so the same stop works on every layout. A stop with no
 * target on screen (Concepts has no tab on a phone) lights the page's title instead, and a stop with
 * no target at all is a card in the middle of the screen.
 */
export interface TourStep {
  id: string;
  /** The page this stop is on; the tour goes there first. */
  route: string;
  target?: readonly string[];
  title: string;
  text: string;
}

/** A link in the app's navigation, wherever this layout keeps it; then the page's own title. */
const nav = (path: string): readonly string[] => [
  `[data-testid="sidebar"] nav a[href="${path}"]`,
  `[data-testid="sidebar"] a[href="${path}"]`,
  `[data-testid="tab-bar"] a[href="${path}"]`,
  "#main h1",
];

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    route: "/library",
    title: "Welcome to Notes",
    text: "This is a one-minute tour of where everything is. Use Next to move on, or Skip at the bottom right to stop at any point.",
  },
  {
    id: "library",
    route: "/library",
    target: nav("/library"),
    title: "Library",
    text: "Everything you have lives here: terms, then courses, then lectures and your own documents. The page opens on what you had open last, then your favorites, then every file.",
  },
  {
    id: "find",
    route: "/library",
    target: ['button:has-text("Quick find")', `[data-testid="tab-bar"] a[href="/search"]`],
    title: "Find anything",
    text: "Search looks through your notes, your slides (handwriting included), concepts and practice questions at once.",
  },
  {
    id: "inbox",
    route: "/inbox",
    target: nav("/inbox"),
    title: "Inbox",
    text: "Upload slides, PDFs and photos of your notes here, or just drag them onto the page. They wait in the inbox until they are filed under a lecture.",
  },
  {
    id: "practice",
    route: "/practice",
    target: nav("/practice"),
    title: "Practice",
    text: "Questions and flashcards made from your own material. Missed questions go to your notebook, and the focus aids beside Pause make a question easier to read.",
  },
  {
    id: "calendar",
    route: "/calendar",
    target: nav("/calendar"),
    title: "Calendar",
    text: "Your exams on their dates, and the days you studied. Pick a day to see what you did.",
  },
  {
    id: "concepts",
    route: "/concepts",
    target: nav("/concepts"),
    title: "Concepts",
    text: "Every drug, class and mechanism from all your courses in one place, with how they connect and where each fact came from.",
  },
  {
    id: "requests",
    route: "/requests",
    target: nav("/requests"),
    title: "Requests",
    text: "Ask an agent to build, fix or explain something. Pick one of your saved instructions and it is built the way you like, every time.",
  },
  {
    id: "settings",
    route: "/settings",
    target: nav("/settings"),
    title: "Settings",
    text: "Light or dark, your own background picture, your saved instructions for agents, and the order of the tabs.",
  },
  {
    id: "guide",
    route: "/help",
    target: ['[data-tour="start"]', "#main h1"],
    title: "The guide, and this tour",
    text: "The guide explains every part in full. To take this tour again, press Take the tour here, at the top of the guide.",
  },
];
