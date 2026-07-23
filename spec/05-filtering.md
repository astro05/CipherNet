# 5. Filtering

Support all Network filters.

Examples:

```
method:POST
status-code:200
domain:example.com
larger-than:100k
mime-type:application/json
has-response-header
is:running
is:from-cache
```

Additional filters:

```
encrypted:true
decrypted:true
api:login
tag:user
hash:xxxx
```
