import { Podcast } from 'podcast';
import type { Database } from 'better-sqlite3';
import { getPublishedArticles } from '../db/articles.js';
import { env } from '../utils/env.js';

export interface FeedConfig {
  baseUrl: string;
}

const PURGED_PREFIX = '[PURGED]';
const TTS_FAILED_PREFIX = '[TTS FAILED]';

export function buildFeedXml(db: Database, config: FeedConfig): string {
  const title = env.PODCAST_TITLE();
  const description = env.PODCAST_DESCRIPTION() || `Narratio: ${title}`;
  const author = env.PODCAST_AUTHOR();
  const language = env.PODCAST_LANGUAGE();

  const feed = new Podcast({
    title,
    description,
    feedUrl: `${config.baseUrl}/rss`,
    siteUrl: config.baseUrl,
    author,
    language,
    generator: 'Narratio',
    customNamespaces: {},
    customElements: [],
    namespaces: { itunes: true },
    itunesAuthor: env.PODCAST_ITUNES_AUTHOR(),
    itunesSummary: env.PODCAST_ITUNES_SUMMARY() || description,
    itunesOwner: {
      name: env.PODCAST_ITUNES_OWNER_NAME(),
      email: env.PODCAST_ITUNES_OWNER_EMAIL(),
    },
    itunesCategory: [{ text: env.PODCAST_ITUNES_CATEGORY() }],
    itunesExplicit: false,
  });

  const articles = getPublishedArticles(db);

  for (const article of articles) {
    let itemTitle = article.title;
    let audioFile: string;

    if (article.status === 'purged') {
      itemTitle = `${PURGED_PREFIX} ${article.title}`;
      audioFile = 'unavailable.wav';
    } else if (article.status === 'failed') {
      itemTitle = `${TTS_FAILED_PREFIX} ${article.title}`;
      audioFile = 'tts-failed.wav';
    } else {
      audioFile = article.audio_file!;
    }

    const audioUrl = `${config.baseUrl}/audio/${encodeURIComponent(audioFile)}`;

    feed.addItem({
      title: itemTitle,
      description: article.content ?? article.title,
      url: article.link ?? config.baseUrl,
      guid: article.guid,
      date: article.pub_date ?? article.created_at,
      imageUrl: article.image_url ?? undefined,
      enclosure: {
        url: audioUrl,
        type: 'audio/wav',
      },
    });
  }

  return feed.buildXml({ indent: '  ' });
}
