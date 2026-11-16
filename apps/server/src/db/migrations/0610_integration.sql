-- Integration: what the domains need to know about each other.

-- A source file filed under a node that then went to the trash is taken back to
-- the inbox, so it never vanishes with the node. This remembers where it was
-- filed, so restoring the node files it there again. It is cleared when someone
-- files the file somewhere else, and when the node is deleted for good.
-- (No foreign key: a deleted node simply stops matching.)
ALTER TABLE source_files ADD COLUMN parked_node_id TEXT;
CREATE INDEX source_files_parked ON source_files (user_id, parked_node_id)
  WHERE parked_node_id IS NOT NULL;
