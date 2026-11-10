# Google Photos Toolkit - Cleanup

A private fork of [xob0t/Google-Photos-Toolkit](https://github.com/xob0t/Google-Photos-Toolkit) (MIT) that adds a guided **Free Up Space** wizard, branded for Prospera. All credit for the toolkit, its API work and the Advanced view goes to xob0t.

## Free Up Space wizard

When you open the toolkit (the Prospera icon in the Google Photos toolbar), a step-by-step wizard opens:

1. **Scan** - one read-only pass over the library (sizes, screenshots, shared albums, Trash). Nothing changes.
2. **Storage saver** - information only: how much Original-quality media there is and a link to Google's setting. The wizard never converts anything.
3. **Big videos** - owned, space-consuming videos over 50 MB, biggest first.
4. **Screenshots and app saves** - screenshots plus Snapchat, WhatsApp and other app saves.
5. **Look-alikes** - near-duplicate bursts and selfies, compared only within 10-minute windows. The best shot in each group is kept.
6. **Empty trash** - shows what is still in Trash and links to Google's Trash page.

Safety rules: the only change the wizard can make is **Move to Trash** (restorable for 60 days), always after a confirm showing the count and size. Items you don't own, items that don't use storage, favorites and items in shared albums are never offered unless you tick the matching "Include" box.

The full original UI is one click away behind **Advanced** (the choice is remembered). Its "Advanced Settings" panel is now called **API Tuning**.

Notes:

- Google's API returns no size for items already in Trash, so the Trash step shows a count, plus the exact size of anything the wizard trashed in this session.
- Google's "screenshots" search also returns camera photos, so a search hit only counts as a screenshot when the file is a PNG.

## How To Install

This repo is private, so Tampermonkey cannot auto-update from it.

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome or Edge.
2. `pnpm install && pnpm build`
3. Drag `google_photos_toolkit.user.js` onto the Tampermonkey dashboard and accept.
4. If the upstream "Google Photos Toolkit" script is installed too, disable it.

## Development

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

To pull upstream fixes: `git fetch upstream && git merge upstream/main`.

## Upstream documentation

### How It Works

In your browser, utilizing GP's undocumented web api

### Finding space-consuming media

This example groups all space-consuming media in one album.

1. Make sure "Library" is the selected source
2. Select `SPACE-CONSUMING` in the `Space` filter
3. Select action `Add to new album`

### Identify media not in any albums

Select all albums in the `Exclude albums` filter, then use appropriate action.

### Identifying duplicates/similar images

Use `Similarity` filter with action `Add to new album`
Media with similar thumbnails will be added to the album.

### Deleting all media in the library

As simple as selecting "Library" source, clicking `Move to trash`, then clearing it.

### Use GPTK's api

GPTK exports it's api class globally so you can use it in your browser's console.  
It's much more powerful than the UI!

Example usage.
Scan the whole library for media owned by `ownerName` and move it to trash if found.

```js
let nextPageId = null;
const ownerName = 'John';
do {
  const page = await gptkApi.getItemsByUploadedDate(nextPageId);
  for (const item of page.items) {
    if (item.isOwned) continue;
    const itemInfo = await gptkApi.getItemInfoExt(item.mediaKey);
    console.log(`${item.mediaKey} is shared by ${itemInfo.owner.name}`);
    if (itemInfo.owner.name == ownerName) {
      await gptkApi.moveItemsToTrash([itemInfo.dedupKey]);
      console.log(`${item.mediaKey} moved to trash`);
    }
  }
  nextPageId = page.nextPageId;
} while (nextPageId);
console.log('DONE');
```

### Contributions welcome

If you want to learn more about how GP's api works, read [https://kovatch.medium.com/deciphering-google-batchexecute-74991e4e446c](https://kovatch.medium.com/deciphering-google-batchexecute-74991e4e446c)  
I just found this post, after doing all the work from zero :D

Also, i've made a userscript that parses all responses and logs them to console in a more readable way, you can find it here - [https://github.com/xob0t/Google-Photos-Toolkit/tree/main/tools](https://github.com/xob0t/Google-Photos-Toolkit/tree/main/tools)

### BUGS

If something does not work, open an [issue](https://github.com/xob0t/Google-Photos-Toolkit/issues) and describe it in detail

If you have a question, open a [discussion](https://github.com/xob0t/Google-Photos-Toolkit/discussions)

### Credits

Borrowed some code and UI inspiration from [undiscord](https://github.com/victornpb/undiscord)

### My Other Google Photos Projects

- Python client with unlimited uploads: [https://github.com/xob0t/gphotos_mobile_client](https://github.com/xob0t/gphotos_mobile_client)
- Disguise any file as media for GP to accept and store it: [https://github.com/xob0t/gp-file-hide](https://github.com/xob0t/gp-file-hide)

### ♥

If GPTK is useful to you, please consider supporting the project:

BTC `12znTocLytrrYhQT4AJVeJdR8KTULWbKb7`  
BTC Cash `qq7w48d6s3rddgxshl6ae48k7c5jyck76crvppqenn`  
DOGE `DQjBzT2qMuXkLMawUXG7umTf3k9VeT4Y6K`  
Etherium `0xcfe559D9F6056F82a6CFdEDA51c00132035955c8`  
Litecoin `ltc1qcgc873py5k28qm85sk5d53yfwzle4cztmvkh6l`
