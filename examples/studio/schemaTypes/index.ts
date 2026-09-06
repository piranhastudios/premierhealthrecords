import {announcement} from './objects/announcement'
import {author} from './documents/author'
import {blockContent} from './objects/blockContent'
import {category} from './documents/category'
import {ctaLink} from './objects/ctaLink'
import {faq} from './objects/faq'
import {homePage} from './singletons/homePage'
import {openingHours} from './objects/openingHours'
import {partner} from './documents/partner'
import {post} from './documents/post'
import {publication} from './documents/publication'
import {seo} from './objects/seo'
import {service} from './documents/service'
import {siteSettings} from './singletons/siteSettings'
import {stat} from './objects/stat'

export const schemaTypes = [
  // Singletons
  homePage,
  siteSettings,
  // Documents
  service,
  post,
  publication,
  author,
  category,
  partner,
  // Objects
  blockContent,
  seo,
  stat,
  announcement,
  ctaLink,
  faq,
  openingHours,
]
