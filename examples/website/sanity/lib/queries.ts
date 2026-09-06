import {defineQuery} from 'next-sanity'

/*
 * Every query receives `$locale` from sanityFetch. A field with a French
 * counterpart is projected as `coalesce(select($locale == "fr" => x_fr), x)`:
 * French when the visitor asked for it and an editor has filled it in,
 * English otherwise. Arrays (rich text) check for content so an emptied French
 * body does not hide the English one.
 */

const imageFields = /* groq */ `
  asset,
  hotspot,
  crop,
  alt
`

const seoFields = /* groq */ `
  "title": coalesce(select($locale == "fr" => title_fr), title),
  "description": coalesce(select($locale == "fr" => description_fr), description),
  image{${imageFields}}
`

export const SITE_SETTINGS_QUERY = defineQuery(`
  *[_type == "siteSettings"][0]{
    title,
    "description": coalesce(select($locale == "fr" => description_fr), description),
    logo{${imageFields}},
    phone,
    email,
    address,
    openingHours[]{
      _key,
      days,
      hours,
      "daysLabel": coalesce(select($locale == "fr" => days_fr), days),
      "hoursLabel": coalesce(select($locale == "fr" => hours_fr), hours)
    },
    socialLinks[]{_key, platform, url},
    navigation[]{_key, "label": coalesce(select($locale == "fr" => label_fr), label), href},
    footerNavigation[]{_key, "label": coalesce(select($locale == "fr" => label_fr), label), href}
  }
`)

export const HOME_PAGE_QUERY = defineQuery(`
  *[_type == "homePage"][0]{
    hero{
      "heading": coalesce(select($locale == "fr" => heading_fr), heading),
      "intro": coalesce(select($locale == "fr" => intro_fr), intro),
      callToAction{"label": coalesce(select($locale == "fr" => label_fr), label), href},
      backgroundImage{${imageFields}},
      images[]{_key, ${imageFields}},
      announcements[]{_key, "text": coalesce(select($locale == "fr" => text_fr), text), link}
    },
    servicesSection{
      "eyebrow": coalesce(select($locale == "fr" => eyebrow_fr), eyebrow),
      "heading": coalesce(select($locale == "fr" => heading_fr), heading),
      "intro": coalesce(select($locale == "fr" => intro_fr), intro)
    },
    aboutSection{
      "eyebrow": coalesce(select($locale == "fr" => eyebrow_fr), eyebrow),
      "heading": coalesce(select($locale == "fr" => heading_fr), heading),
      "body": coalesce(select($locale == "fr" && count(body_fr) > 0 => body_fr), body),
      image{${imageFields}},
      featuredStat{value, "label": coalesce(select($locale == "fr" => label_fr), label)},
      stats[]{_key, value, "label": coalesce(select($locale == "fr" => label_fr), label)}
    },
    partnersSection{
      "heading": coalesce(select($locale == "fr" => heading_fr), heading),
      "intro": coalesce(select($locale == "fr" => intro_fr), intro)
    },
    contactSection{
      "eyebrow": coalesce(select($locale == "fr" => eyebrow_fr), eyebrow),
      "heading": coalesce(select($locale == "fr" => heading_fr), heading),
      "intro": coalesce(select($locale == "fr" => intro_fr), intro)
    },
    seo{${seoFields}}
  }
`)

const serviceListFields = /* groq */ `
  _id,
  "title": coalesce(select($locale == "fr" => title_fr), title),
  "slug": slug.current,
  "summary": coalesce(select($locale == "fr" => summary_fr), summary),
  icon,
  image{${imageFields}}
`

export const SERVICES_QUERY = defineQuery(`
  *[_type == "service"] | order(orderRank asc, title asc){
    ${serviceListFields}
  }
`)

/** People shown in the "Our Team" section of the About page. */
export const TEAM_QUERY = defineQuery(`
  *[_type == "author" && teamStatus == "current"] | order(orderRank asc, name asc){
    _id,
    name,
    "role": coalesce(select($locale == "fr" => role_fr), role),
    image{${imageFields}}
  }
`)

export const SERVICES_PAGE_QUERY = defineQuery(`
  *[_type == "service"] | order(orderRank asc, title asc){
    ${serviceListFields},
    "body": coalesce(select($locale == "fr" && count(body_fr) > 0 => body_fr), body),
    faqs[]{
      _key,
      "question": coalesce(select($locale == "fr" => question_fr), question),
      "answer": coalesce(select($locale == "fr" => answer_fr), answer)
    }
  }
`)

export const SERVICE_QUERY = defineQuery(`
  *[_type == "service" && slug.current == $slug][0]{
    ${serviceListFields},
    "body": coalesce(select($locale == "fr" && count(body_fr) > 0 => body_fr), body),
    seo{${seoFields}}
  }
`)

export const PARTNERS_QUERY = defineQuery(`
  *[_type == "partner"] | order(orderRank asc, name asc){
    _id,
    name,
    logo{${imageFields}},
    website
  }
`)

const postListFields = /* groq */ `
  _id,
  "title": coalesce(select($locale == "fr" => title_fr), title),
  "slug": slug.current,
  "excerpt": coalesce(select($locale == "fr" => excerpt_fr), excerpt),
  publishedAt,
  mainImage{${imageFields}},
  author->{_id, name, "slug": slug.current, "role": coalesce(select($locale == "fr" => role_fr), role), image{${imageFields}}},
  categories[]->{_id, "title": coalesce(select($locale == "fr" => title_fr), title), "slug": slug.current}
`

export const POSTS_QUERY = defineQuery(`
  *[_type == "post" && defined(slug.current)] | order(publishedAt desc){
    ${postListFields}
  }
`)

export const POST_QUERY = defineQuery(`
  *[_type == "post" && slug.current == $slug][0]{
    ${postListFields},
    "body": coalesce(select($locale == "fr" && count(body_fr) > 0 => body_fr), body),
    seo{${seoFields}}
  }
`)

export const POST_SLUGS_QUERY = defineQuery(`
  *[_type == "post" && defined(slug.current)]{"slug": slug.current}
`)

const publicationListFields = /* groq */ `
  _id,
  "title": coalesce(select($locale == "fr" => title_fr), title),
  "slug": slug.current,
  publicationType,
  "abstract": coalesce(select($locale == "fr" => abstract_fr), abstract),
  publishedAt,
  journal,
  doi,
  externalUrl,
  "fileUrl": file.asset->url,
  coverImage{${imageFields}},
  authors[]->{_id, name, "slug": slug.current, "role": coalesce(select($locale == "fr" => role_fr), role)},
  externalAuthors,
  categories[]->{_id, "title": coalesce(select($locale == "fr" => title_fr), title), "slug": slug.current}
`

export const PUBLICATIONS_QUERY = defineQuery(`
  *[_type == "publication" && defined(slug.current)] | order(publishedAt desc){
    ${publicationListFields}
  }
`)

export const PUBLICATION_QUERY = defineQuery(`
  *[_type == "publication" && slug.current == $slug][0]{
    ${publicationListFields},
    "body": coalesce(select($locale == "fr" && count(body_fr) > 0 => body_fr), body),
    seo{${seoFields}}
  }
`)

export const PUBLICATION_SLUGS_QUERY = defineQuery(`
  *[_type == "publication" && defined(slug.current)]{"slug": slug.current}
`)
