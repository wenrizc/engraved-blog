import poetryData from './generated/poetry-quotes.json';

export interface PoetryQuote {
  id: string;
  text: string;
  lines: string[];
  author: string;
  work: string;
}

export const poetryQuotes = poetryData.quotes as PoetryQuote[];
