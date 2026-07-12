# Table Fixture

| Field       | Type    | Required | Notes                     |
| ----------- | ------- | -------- | -------------------------- |
| `docId`     | string  | yes      | GDoc file ID                |
| `prNumber`  | number  | yes      | Target GitHub PR            |
| `syncedAt`  | ISO8601 | no       | Last successful sync time   |
| `dryRun`    | boolean | no       | Skip write, log only        |

Second table with alignment markers:

| Left | Center | Right |
| :--- | :----: | ----: |
| a    | b      | c     |
| 1234 | 5      | 6789  |
