#!/bin/bash
# Simple example index creation for OpenSearch

curl -X PUT "http://localhost:9200/example-index" -H 'Content-Type: application/json' -d'
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "created_at": { "type": "date" }
    }
  }
}
'
