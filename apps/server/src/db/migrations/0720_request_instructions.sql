-- The instruction she chose when leaving a request (Settings, "Instructions"; the request dialog's
-- picker): a copy of its title and body as they were at that moment, as JSON, or NULL when she chose
-- none. A copy, not a link: changing or deleting a saved instruction later never rewrites what an
-- older request asked for.
ALTER TABLE requests ADD COLUMN instructions TEXT;
