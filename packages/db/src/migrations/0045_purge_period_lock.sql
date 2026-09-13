-- The lock step was removed from the reporting workflow: approve is now the
-- end of the line, and an agreed period only leaves that state through reopen.
-- Every period still carrying the retired status becomes approved. The lock
-- stamp columns (locked_by_id / locked_at) are kept as history — they are read
-- only by the detail export and are cleared if the period is reopened.
UPDATE "reporting_period" SET "status" = 'approved' WHERE "status" = 'locked';