import type { ImageAttachment } from '@shared/types'

const MAX_SIDE = 1568 // au-delà, les modèles redimensionnent eux-mêmes : on économise des tokens
const MAX_IMAGES = 8
const SUPPORTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Lecture du fichier impossible'))
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = src
  })
}

/** Convertit un fichier image en pièce jointe, réduite si elle est très grande. */
export async function toAttachment(file: File): Promise<ImageAttachment> {
  if (!file.type.startsWith('image/')) throw new Error(`« ${file.name} » n’est pas une image`)
  const url = await readDataUrl(file)
  const img = await loadImage(url)
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const supported = (SUPPORTED as readonly string[]).includes(file.type)
  if (scale === 1 && supported && file.size < 3_500_000) {
    return { mediaType: file.type as ImageAttachment['mediaType'], data: url.slice(url.indexOf(',') + 1) }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  // Les captures (PNG) gardent un texte net ; les photos passent en JPEG, bien plus léger
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const out = canvas.toDataURL(type, 0.88)
  return { mediaType: type, data: out.slice(out.indexOf(',') + 1) }
}

/** Ajoute des fichiers aux pièces jointes existantes ; renvoie aussi les erreurs à afficher. */
export async function addImages(current: ImageAttachment[], files: Iterable<File>): Promise<{ images: ImageAttachment[]; errors: string[] }> {
  const images = [...current]
  const errors: string[] = []
  for (const f of files) {
    if (images.length >= MAX_IMAGES) {
      errors.push(`${MAX_IMAGES} images maximum par message`)
      break
    }
    try {
      images.push(await toAttachment(f))
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  return { images, errors }
}

export const imageSrc = (img: ImageAttachment): string => `data:${img.mediaType};base64,${img.data}`
