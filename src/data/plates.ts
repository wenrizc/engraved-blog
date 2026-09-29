import generated from './generated/plates.json';

export type PlateOrientation = 'portrait' | 'landscape';

export interface PlateRecord {
  id: string;
  file: string;
  title: string;
  artist: string;
  date: string;
  medium: string;
  objectName: string;
  orientation: PlateOrientation;
  width: number;
  height: number;
  caption: string;
  meta: string;
  credit: string;
  alt: string;
  sourceUrl: string;
}

export interface Plate extends PlateRecord {
  image: ImageMetadata;
}

const images = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/prints/*.{jpg,jpeg,png,webp}',
  { eager: true }
);

export const plateRecords = generated.plates as PlateRecord[];

// Keep only records whose mirrored file is actually present on disk.
export const plates: Plate[] = plateRecords.flatMap((record) => {
  const entry = Object.entries(images).find(([file]) => file.endsWith(`/${record.file}`));
  return entry ? [{ ...record, image: entry[1].default }] : [];
});
