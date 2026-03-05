# Unsplash API Integration Plan

## Objective

Add reliable image fetching using the Unsplash API with Wikimedia Commons as fallback.

## Implementation Steps

### 1. Add Environment Variable for API Key

- Add `UNSPLASH_ACCESS_KEY` to backend environment configuration
- File: `backend/app/core/config.py`

### 2. Create New Image Tool

Add a new tool `get_image` to the tool registry that:

- Uses Unsplash API `/photos/random` endpoint
- Accepts `query` parameter for search term
- Returns image URL, photographer credit, and attribution

### 3. Implement Wikimedia Commons Fallback

If Unsplash API fails, fallback to Wikimedia Commons:

- Use their API to search for images
- Return similar data structure

### 4. Update Tool Description

Modify `web_search` description to recommend using the new `get_image` tool for images

## API Details

### Unsplash API Call

```
GET https://api.unsplash.com/photos/random
Headers: Authorization: Client-ID {ACCESS_KEY}
Params: query=goat, orientation=landscape
```

### Response Structure

```json
{
  "urls": {
    "regular": "https://images.unsplash.com/...",
    "full": "...",
    "thumb": "..."
  },
  "links": {
    "html": "https://unsplash.com/photos/..."
  },
  "user": {
    "name": "Photographer Name",
    "links": {
      "html": "https://unsplash.com/@username"
    }
  }
}
```

## Files to Modify

1. `backend/app/core/config.py` - Add UNSPLASH_ACCESS_KEY
2. `backend/app/tools/registry.py` - Add new get_image tool with Unsplash + Wikimedia fallback
