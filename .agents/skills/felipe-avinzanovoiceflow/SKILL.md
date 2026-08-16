```markdown
# felipe-avinzanovoiceflow Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides guidance on the development patterns and conventions used in the `felipe-avinzanovoiceflow` JavaScript codebase. It covers file naming, import/export styles, commit message conventions, and testing patterns. This documentation is intended to help contributors maintain consistency and quality across the project.

## Coding Conventions

### File Naming
- All files use **kebab-case**.
- Example:  
  ```bash
  user-controller.js
  voiceflow-service.js
  ```

### Import Style
- Use **relative imports** for modules within the project.
- Example:
  ```javascript
  import { getUser } from './user-controller.js';
  ```

### Export Style
- Use **named exports**.
- Example:
  ```javascript
  // user-controller.js
  export function getUser(id) { ... }
  export function createUser(data) { ... }
  ```

### Commit Messages
- Follow the **conventional commits** format.
- Use the `feat` prefix for new features.
- Example:
  ```
  feat: add support for new voiceflow intents
  ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new feature or functionality  
**Command:** `/add-feature`

1. Create a new file using kebab-case naming.
2. Write your code using named exports.
3. Use relative imports to include other modules.
4. Write corresponding tests in a `.test.ts` file.
5. Commit your changes with a `feat:` prefix and a clear description.
6. Open a pull request for review.

### Writing Tests
**Trigger:** When adding or updating functionality  
**Command:** `/write-test`

1. Create a test file with the `.test.ts` extension.
2. Place the test file alongside the code it tests or in a `tests/` directory.
3. Write tests according to the project's preferred (unknown) framework.
4. Run the tests to ensure they pass.

## Testing Patterns

- Test files use the `*.test.ts` naming convention.
- The specific testing framework is not detected; follow existing patterns in the repository.
- Example test file:
  ```typescript
  // user-controller.test.ts
  import { getUser } from './user-controller';

  describe('getUser', () => {
    it('should return user data for a valid id', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command        | Purpose                                      |
|----------------|----------------------------------------------|
| /add-feature   | Start the workflow for adding a new feature  |
| /write-test    | Begin writing tests for new or updated code  |
```