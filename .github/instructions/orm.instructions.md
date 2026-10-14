# Database Access Rules

## Mandatory ORM Usage

When interacting with the database, always use **Sequelize ORM**.

### Rules

- Never write or execute raw SQL queries.
- Never use `sequelize.query()` unless explicitly approved and documented.
- Always use Sequelize Models, Associations, Scopes, and Query Methods.
- Prefer ORM methods such as:
  - `findOne`
  - `findAll`
  - `findByPk`
  - `create`
  - `bulkCreate`
  - `update`
  - `destroy`
  - `upsert`
  - `count`
  - `sum`
  - `max`
  - `min`
- Use Sequelize relationships (`hasOne`, `hasMany`, `belongsTo`, `belongsToMany`) instead of manual JOIN statements.
- Use eager loading with `include` rather than raw JOIN queries.
- Follow existing model definitions and naming conventions.
- Keep all database logic within the repository, service, or data access layer.

### Prohibited Examples

❌ Raw SQL

```javascript
const users = await sequelize.query(
  'SELECT * FROM users WHERE status = "ACTIVE"'
);