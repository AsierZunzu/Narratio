import { Podcast } from 'podcast';
import type { Db, Feed } from '../db/index.js';
import { getPublishedArticlesByFeed } from '../db/articles.js';

const PURGED_PREFIX = '[PURGED]';
const TTS_FAILED_PREFIX = '[TTS FAILED]';

export function buildFeedXml(db: Db, feed: Feed, baseUrl: string): string {
  const description = feed.description || `Narratio: ${feed.title}`;
  const imageUrl = feed.image_file ? `${baseUrl}/feed-images/${encodeURIComponent(feed.image_file)}` : undefined;

  const podcast = new Podcast({
    title: feed.title,
    description,
    feedUrl: `${baseUrl}/rss/${feed.slug}`,
    siteUrl: baseUrl,
    ...(imageUrl ? { imageUrl } : {}),
    author: feed.author,
    language: feed.language,
    generator: 'Narratio',
    customNamespaces: {},
    customElements: [],
    namespaces: { iTunes: true },
    itunesAuthor: feed.itunes_author ?? feed.author,
    itunesSummary: feed.itunes_summary ?? description,
    ...(imageUrl ? { itunesImage: imageUrl } : {}),
    itunesOwner: {
      name: feed.itunes_owner_name ?? feed.author,
      email: feed.itunes_owner_email ?? 'worker@example.com',
    },
    itunesCategory: [{ text: feed.itunes_category }],
    itunesExplicit: false,
  });

  const articles = getPublishedArticlesByFeed(db, feed.id);

  for (const article of articles) {
    let itemTitle = article.title;
    let audioFile: string;

    if (article.status === 'purged') {
      itemTitle = `${PURGED_PREFIX} ${article.title}`;
      audioFile = `unavailable-${feed.id}.wav`;
    } else if (article.status === 'failed') {
      itemTitle = `${TTS_FAILED_PREFIX} ${article.title}`;
      audioFile = `tts-failed-${feed.id}.wav`;
    } else {
      audioFile = article.audio_file!;
    }

    const audioUrl = `${baseUrl}/audio/${encodeURIComponent(audioFile)}`;

    podcast.addItem({
      title: itemTitle,
      description: article.content ?? article.title,
      url: article.link ?? baseUrl,
      guid: article.guid,
      date: article.pub_date ?? article.created_at,
      imageUrl: article.image_url ?? undefined,
      enclosure: {
        url: audioUrl,
        type: 'audio/wav',
      },
    });
  }

  return podcast.buildXml({ indent: '  ' });
}
