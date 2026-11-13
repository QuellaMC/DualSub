# Chrome Web Store listing

What the DualSub listing shows in each of its languages. Its text and images live here together so they change together.

## Summary

Chrome takes the listing's one-line summary from the extension's description: `appDesc` in each `public/_locales/<locale>/messages.json`, at most 132 characters. It changes only with a release. Each language's description opens with the same sentence.

## Languages

Each folder is one listing language, named by its code in the store's language menu: `en` (the default), `es`, `ja`, `ko`, `zh-CN` and `zh-TW`. Paste its `description.md` into the Description field, and upload its screenshots in order.

The English screenshots show a Spanish line with its English translation. The others show an English line, the source most of their viewers watch, translated into the listing's language.

## Images

| File                                                              | Listing field                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| `<language>/1-dual-subtitles.png` … `<language>/5-your-style.png` | Screenshots, in this order (1280×800)                          |
| `promo-small-440x280.png`                                         | Small promo tile, for every language                           |
| `promo-marquee-1400x560.png`                                      | Marquee promo tile, for every language; also the README banner |
