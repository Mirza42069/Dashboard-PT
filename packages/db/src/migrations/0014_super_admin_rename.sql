-- Three-tier RBAC: the old global 'admin' becomes 'super_admin'; 'admin' is
-- reborn as a company-pinned tenant administrator. Every existing admin was
-- global, so they all migrate up. Sessions read role from this table on every
-- request, so this takes effect immediately with no re-login.
UPDATE "user" SET "role" = 'super_admin' WHERE "role" = 'admin';