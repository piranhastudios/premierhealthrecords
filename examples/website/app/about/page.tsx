import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Shield, Clock, Heart, Globe, Facebook, Twitter, Linkedin } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Footer } from "@/components/footer"

const values = [
  {
    icon: Shield,
    title: "Quality Healthcare",
    description: "Our dedication to patient safety and well-being, sets the benchmark for uncompromising quality in medical services."
  },
  {
    icon: Clock,
    title: "Time Effectiveness",
    description: "We prioritize efficiency without compromising the thoroughness and effectiveness of medical care."
  },
  {
    icon: Heart,
    title: "Humanized Care",
    description: "We are committed to a way of life, which identifies the needs and health demands of patients who require professional care."
  },
  {
    icon: Globe,
    title: "International Standards",
    description: "We adhere to global best practices and maintain international healthcare standards in all our services."
  }
]

const team = [
  {
    name: "Professor Theodore Ngatchu",
    role: "Managing Director",
    image: "/images/team/director.jpg",
    socials: { facebook: "#", twitter: "#", linkedin: "#" }
  },
  {
    name: "Dr. Adeline Affong",
    role: "Clinical Director",
    image: "/images/team/clinical-director.jpg",
    socials: { facebook: "#", twitter: "#", linkedin: "#" }
  },
  {
    name: "Dr. Lowe Yvana",
    role: "General Physician",
    image: "/images/team/physician-1.jpg",
    socials: { facebook: "#", twitter: "#", linkedin: "#" }
  },
  {
    name: "Dr. Paul Andang",
    role: "General Physician",
    image: "/images/team/physician-2.jpg",
    socials: { facebook: "#", twitter: "#", linkedin: "#" }
  }
]

const stats = [
  { value: "15+", label: "Years of Experience" },
  { value: "50+", label: "Medical Professionals" },
  { value: "10,000+", label: "Patients Served" },
  { value: "20+", label: "Medical Services" }
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      
      {/* Hero Section */}
      <section
        className="bg-card py-16 md:py-24"
        style={{
          marginTop: "calc(var(--header-h, 93px) * -1)",
          paddingTop: "calc(4rem + var(--header-h, 93px))",
        }}
      >
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Left Content */}
            <div className="flex flex-col justify-center">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                About Us
              </span>
              <h1 className="mt-4 font-serif text-4xl leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl text-balance">
                We place <span className="text-accent">people</span> at the heart of healthcare
              </h1>
              
              <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
                At Premier Health Centres, we have a clear mission of bringing affordable, quality healthcare to the population, while offering a one-stop solution for all medical needs.
              </p>

              <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
                We pride ourselves in providing a world-class medical facility in a comfortable and digitally advanced environment.
              </p>

              <div className="mt-8">
                <Link
                  href="/#contact"
                  className="group inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-accent"
                >
                  Book an appointment
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            {/* Right - Images */}
            <div className="relative">
              {/* Decorative crosses */}
              <div className="absolute -top-4 right-1/4 text-accent/30 text-xl">+</div>
              <div className="absolute top-1/4 -right-2 text-accent/30 text-xl">+</div>
              <div className="absolute bottom-1/4 right-1/3 text-accent/30 text-xl">+</div>
              
              {/* Images */}
              <div className="relative h-80 md:h-96 lg:h-[450px]">
                <div className="absolute right-0 top-0 h-48 w-40 overflow-hidden rounded-2xl border border-border shadow-lg md:h-56 md:w-48 lg:h-64 lg:w-56">
                  <Image
                    src="/images/hero-healthcare.jpg"
                    alt="Healthcare professional"
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="absolute bottom-0 left-0 h-48 w-52 overflow-hidden rounded-2xl border border-border shadow-lg md:h-56 md:w-60 lg:left-12 lg:h-64 lg:w-72">
                  <Image
                    src="/images/building-facade.jpg"
                    alt="Our facility"
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 gap-6 rounded-2xl border border-border bg-background p-8 md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="font-serif text-3xl font-bold text-accent md:text-4xl">
                  {stat.value}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Values Section */}
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
            {/* Values Content */}
            <div>
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                What We Stand For
              </span>
              <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
                Our Core <span className="text-accent">Values</span>
              </h2>
              <div className="mt-10 space-y-8">
                {values.map((value) => (
                  <div key={value.title} className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                      <value.icon className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold uppercase tracking-wide text-foreground">
                        {value.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {value.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Values Image */}
            <div className="relative">
              <div className="sticky top-32">
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-border shadow-lg">
                  <Image
                    src="/images/patient-care.jpg"
                    alt="Healthcare compassion"
                    fill
                    className="object-cover"
                  />
                </div>
                {/* Decorative elements */}
                <div className="absolute -bottom-4 -left-4 text-2xl text-accent/30">+</div>
                <div className="absolute -top-4 -right-4 text-2xl text-accent/30">+</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="bg-card py-20 md:py-32">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="text-center">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Our Purpose
            </span>
            <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              Mission & <span className="text-accent">Vision</span>
            </h2>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background p-8 md:p-12">
              <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                Our Mission
              </span>
              <h3 className="mt-4 font-serif text-2xl font-medium text-foreground md:text-3xl">
                Accessible Healthcare for All
              </h3>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                To provide affordable, quality healthcare services to the population of Cameroon and beyond, ensuring that every individual has access to world-class medical care regardless of their socioeconomic background. We are committed to excellence in patient care, medical education, and community health.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-8 md:p-12">
              <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                Our Vision
              </span>
              <h3 className="mt-4 font-serif text-2xl font-medium text-foreground md:text-3xl">
                Leading Healthcare Excellence
              </h3>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                To be the leading multidisciplinary healthcare provider in Central Africa, recognized for our commitment to patient-centered care, innovative medical practices, and contribution to improving health outcomes in the communities we serve.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="text-center">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Our Experts
            </span>
            <h2 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
              Meet Our <span className="text-accent">Team</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Meet the Directors and our Medical Professionals. World-Class Global Experts in Medical Aesthetics, Psychiatry, Hepatitis Treatment, and more.
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {team.map((member) => (
              <div
                key={member.name}
                className="group rounded-2xl border border-border bg-card p-6 text-center transition-shadow hover:shadow-lg"
              >
                <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-full border-2 border-accent/20">
                  <Image
                    src={member.image}
                    alt={member.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <h3 className="mt-5 font-serif text-lg font-medium text-foreground">
                  {member.name}
                </h3>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-accent">
                  {member.role}
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Link
                    href={member.socials.facebook}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent"
                  >
                    <Facebook className="h-4 w-4" />
                  </Link>
                  <Link
                    href={member.socials.twitter}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent"
                  >
                    <Twitter className="h-4 w-4" />
                  </Link>
                  <Link
                    href={member.socials.linkedin}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent"
                  >
                    <Linkedin className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-foreground py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center md:px-8">
          <h2 className="font-serif text-3xl font-medium text-card md:text-4xl">
            Experience Quality Healthcare Today
          </h2>
          <p className="mt-4 text-card/80">
            Join thousands of satisfied patients who trust Premier Health Centres for their healthcare needs.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/#contact"
              className="inline-flex items-center justify-center rounded-full bg-accent px-8 py-3 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
            >
              Book an Appointment
            </Link>
            <Link
              href="/services"
              className="inline-flex items-center justify-center rounded-full border border-card/30 px-8 py-3 text-sm font-semibold text-card transition-colors hover:bg-card/10"
            >
              View Our Services
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
