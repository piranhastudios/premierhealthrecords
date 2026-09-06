import {defineQuery} from 'next-sanity'

const imageFields = /* groq */ `
  asset,
  hotspot,
  crop,
  alt
`

export const SITE_SETTINGS_QUERY = defineQuery(`
  *[_type == "siteSettings"][0]{
    title,
    description,
    logo{${imageFields}},
    phone,
    email,
    address,
    openingHours[]{_key, days, hours},
    socialLinks[]{_key, platform, url},
    navigation[]{_key, label, href},
    footerNavigation[]{_key, label, href}
  }
`)

export const HOME_PAGE_QUERY = defineQuery(`
  *[_type == "homePage"][0]{
    hero{
      heading,
      intro,
      callToAction{label, href},
      backgroundImage{${imageFields}},
      images[]{_key, ${imageFields}},
      announcements[]{_key, text, link}
    },
    servicesSection{eyebrow, heading, intro},
    aboutSection{
      eyebrow,
      heading,
      body,
      image{${imageFields}},
      featuredStat{value, label},
      stats[]{_key, value, label}
    },
    partnersSection{heading, intro},
    contactSection{eyebrow, heading, intro},
    seo{title, description, image{${imageFields}}}
  }
`)

export const SERVICES_QUERY = defineQuery(`
  *[_type == "service"] | order(orderRank asc, title asc){
    _id,
    title,
    "slug": slug.current,
    summary,
    icon,
    image{${imageFields}}
  }
`)

export const SERVICES_PAGE_QUERY = defineQuery(`
  *[_type == "service"] | order(orderRank asc, title asc){
    _id,
    title,
    "slug": slug.current,
    summary,
    icon,
    image{${imageFields}},
    body,
    faqs[]{_key, question, answer}
  }
`)

export const SERVICE_QUERY = defineQuery(`
  *[_type == "service" && slug.current == $slug][0]{
    _id,
    title,
    "slug": slug.current,
    summary,
    icon,
    image{${imageFields}},
    body,
    seo{title, description, image{${imageFields}}}
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
  title,
  "slug": slug.current,
  excerpt,
  publishedAt,
  mainImage{${imageFields}},
  author->{_id, name, "slug": slug.current, role, image{${imageFields}}},
  categories[]->{_id, title, "slug": slug.current}
`

export const POSTS_QUERY = defineQuery(`
  *[_type == "post" && defined(slug.current)] | order(publishedAt desc){
    ${postListFields}
  }
`)

export const POST_QUERY = defineQuery(`
  *[_type == "post" && slug.current == $slug][0]{
    ${postListFields},
    body,
    seo{title, description, image{${imageFields}}}
  }
`)

export const POST_SLUGS_QUERY = defineQuery(`
  *[_type == "post" && defined(slug.current)]{"slug": slug.current}
`)

const publicationListFields = /* groq */ `
  _id,
  title,
  "slug": slug.current,
  publicationType,
  abstract,
  publishedAt,
  journal,
  doi,
  externalUrl,
  "fileUrl": file.asset->url,
  coverImage{${imageFields}},
  authors[]->{_id, name, "slug": slug.current, role},
  externalAuthors,
  categories[]->{_id, title, "slug": slug.current}
`

export const PUBLICATIONS_QUERY = defineQuery(`
  *[_type == "publication" && defined(slug.current)] | order(publishedAt desc){
    ${publicationListFields}
  }
`)

export const PUBLICATION_QUERY = defineQuery(`
  *[_type == "publication" && slug.current == $slug][0]{
    ${publicationListFields},
    body,
    seo{title, description, image{${imageFields}}}
  }
`)

export const PUBLICATION_SLUGS_QUERY = defineQuery(`
  *[_type == "publication" && defined(slug.current)]{"slug": slug.current}
`)
