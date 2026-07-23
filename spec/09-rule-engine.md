# 9. Rule Engine

Create configurable rules.

Example:

```
IF

Host == api.company.com

AND

Path starts with /v2/

THEN

Decrypt Response

Algorithm = AES-GCM

Key = xxxx

IV = yyyy
```

Support:

* URL
* Host
* Method
* Header
* Cookie
* Content-Type
* Regex
* Status

Rules should support priority.

Enable/disable.

Import/export JSON.
