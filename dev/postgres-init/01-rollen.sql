-- App-Rolle: kein Superuser, kann Row-Level-Security nicht umgehen.
create role autonomo_app login password 'app' nosuperuser nobypassrls;
