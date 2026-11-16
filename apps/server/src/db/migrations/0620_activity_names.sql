-- One naming scheme for the activity log and the change feed: "<area>.<past-tense verb>"
-- (library.created, block.edited, request.claimed, question.authored, concept.upserted, ...).
-- Rewrites the rows written under the old, inconsistent names. The feed's "document.updated"
-- (any commit) cannot be traced to one operation any more, so it becomes "document.edited".
UPDATE changes SET action = CASE action
  WHEN 'node.created' THEN 'library.created'
  WHEN 'node.updated' THEN 'library.updated'
  WHEN 'node.moved' THEN 'library.moved'
  WHEN 'node.duplicated' THEN 'library.duplicated'
  WHEN 'node.trashed' THEN 'library.trashed'
  WHEN 'node.restored' THEN 'library.restored'
  WHEN 'node.deleted' THEN 'library.deleted'
  WHEN 'document.updated' THEN 'document.edited'
  WHEN 'document.reviewed' THEN 'block.reviewed'
  WHEN 'document.restored_from_trash' THEN 'document.untrashed'
  WHEN 'request.claim' THEN 'request.claimed'
  WHEN 'request.release' THEN 'request.released'
  WHEN 'request.complete' THEN 'request.completed'
  WHEN 'request.decline' THEN 'request.declined'
  WHEN 'question.created' THEN 'question.authored'
  WHEN 'concept.bulk_upserted' THEN 'concept.upserted'
  WHEN 'concept.source_deleted' THEN 'concept.unsourced'
  WHEN 'canvas.structure_set' THEN 'canvas.arranged'
  WHEN 'canvas.changed' THEN 'canvas.edited'
  WHEN 'canvas.merged' THEN 'canvas.synced'
  ELSE action END
WHERE action IN ('node.created', 'node.updated', 'node.moved', 'node.duplicated', 'node.trashed',
  'node.restored', 'node.deleted', 'document.updated', 'document.reviewed',
  'document.restored_from_trash', 'request.claim', 'request.release', 'request.complete',
  'request.decline', 'question.created', 'concept.bulk_upserted', 'concept.source_deleted',
  'canvas.structure_set', 'canvas.changed', 'canvas.merged');

UPDATE activity SET action = CASE action
  WHEN 'create_document' THEN 'document.created'
  WHEN 'insert_blocks' THEN 'block.inserted'
  WHEN 'blocks.insert' THEN 'block.inserted'
  WHEN 'update_block' THEN 'block.edited'
  WHEN 'move_blocks' THEN 'block.moved'
  WHEN 'delete_blocks' THEN 'block.deleted'
  WHEN 'replace_generated' THEN 'block.regenerated'
  WHEN 'restore_revision' THEN 'document.restored'
  WHEN 'review' THEN 'block.reviewed'
  WHEN 'batch' THEN 'document.edited'
  WHEN 'document.updated' THEN 'document.edited'
  WHEN 'document.reviewed' THEN 'block.reviewed'
  WHEN 'document.restored_from_trash' THEN 'document.untrashed'
  WHEN 'request.claim' THEN 'request.claimed'
  WHEN 'request.release' THEN 'request.released'
  WHEN 'request.complete' THEN 'request.completed'
  WHEN 'request.decline' THEN 'request.declined'
  WHEN 'question.created' THEN 'question.authored'
  WHEN 'concept.bulk_upserted' THEN 'concept.upserted'
  WHEN 'canvas.structure_set' THEN 'canvas.arranged'
  WHEN 'canvas.changed' THEN 'canvas.edited'
  ELSE action END
WHERE action IN ('create_document', 'insert_blocks', 'blocks.insert', 'update_block', 'move_blocks',
  'delete_blocks', 'replace_generated', 'restore_revision', 'review', 'batch', 'document.updated',
  'document.reviewed', 'document.restored_from_trash', 'request.claim', 'request.release',
  'request.complete', 'request.decline', 'question.created', 'concept.bulk_upserted',
  'canvas.structure_set', 'canvas.changed');
