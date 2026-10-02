import { Link } from 'react-router-dom';
import { Award, ArrowRight } from 'lucide-react';
import { RevealOnScroll } from '../components/motion/RevealOnScroll';

interface Visionary {
  name: string;
  role: string;
  image: string;
  roleBadgeStyle: string;
  paragraphs: string[];
}

const VISIONARIES: Visionary[] = [
  {
    name: 'Sri. K. Subba Rao',
    role: 'CHAIRMAN',
    image: '/visionaries/chairman.png',
    roleBadgeStyle: 'text-kits-red bg-red-50 border-red-200',
    paragraphs: [
      'Philanthropist, Educationist, Visionary are some of the attributes which have been associated with Chairman K. Subba Rao. He was born in an agricultural family in 1972 at Vinjanampadu village and has come up in life through hard work, dedication and total commitment. He had his primary schooling at Vinjanampadu and Secondary Schooling at Ananthavarapadu village. He did his intermediate course at Hindu college and graduated from JKC College, Guntur. Later he completed his Post Graduation in Mathematics from Bhavnagar University, Gujarat.',
      'At a very young age, he proved himself as an excellent academician. The establishment of this college has fulfilled his long-cherished dream of starting an Engineering College to serve the student community by offering technical education in both conventional and hi-tech disciplines of engineering with all the state-of-art facilities. His main objective is to promote an educational institution for the overall benefit of the country in general, and the state in particular. "A person who dares to dream big and commands the ability to realize it". Mr. Subba Rao started his professional career as a Lecturer in Mathematics. He worked at JKC College for six years. Later he worked for GSR Educational Institutions as Executive Director, proving himself as a man of versatile personality with inexhaustible funds of creative ideas and undeterred perseverance. He followed the footsteps of his Guru, Sri C. Subba Rao, the former Chairman of the Andhra Pradesh State Council for Higher Education, by introducing innovative administrative practices, modern teaching methodologies, and infrastructure that meets international standards. KITS AKSHAR will remain one of the best engineering colleges in India wherein he continues to put his maximum effort and avid interest into its continual development, the growth of which the prime beneficiaries will be the students.',
    ],
  },
  {
    name: 'Sri. Koyi Sekhar',
    role: 'SECRETARY',
    image: '/visionaries/secretary.png',
    roleBadgeStyle: 'text-kits-blue bg-blue-50 border-blue-200',
    paragraphs: [
      'Sri Koyi Sekhar, the secretary of KITS Akshar Institute of Technology (Formerly Guntur Engineering College), is the person of whose efforts are the cause for the successful journey of KITS Akshar Institute of Technology (Formerly Guntur Engineering College). Sri Koyi Sekhar stands as synonym for hard work, discipline, committment and concern.',
      'Sri Koyi Sekhar began his career with his services at Avanthi Group of Instituions, Hyderabad. Later, he moved to Avanthi Engineering College, Vizag. He has assilnilated huge experience in the field of engineering studies. He has proved himself to be a successful administrator in keeping an engineering college on a track of success. Encouraged by his vast experience in this field, it struck in his mind to found a college on his own. Thus was born this reputed KITS Akshar Institute of Technology (Formerly Guntur Engineering College).',
      'He took up task of preopening the instituion to hisnnreathe and put in Titanic efforts. He is designed as the secretary of the institution. Since then his fireless striving towards achieving perfection is remarkable. He has been with the students sharing their joys and troubles. His endeavors have proved mighty in achieving glory to the institution. Not absured to say he is one and all in success of this instituion.',
    ],
  },
  {
    name: 'Mr. Gogineni Samba Siva Rao',
    role: 'DIRECTOR',
    image: '/visionaries/director.png',
    roleBadgeStyle: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    paragraphs: [
      'A fervent promoter for universal education, initiated his teaching career during postgraduate studies. He founded an educational society, including residential intermediate college, school, and degree college. Currently, as Director at KITS Akshar Institute of Technology, he mentors students, guiding their academic paths with utmost dedication.',
    ],
  },
  {
    name: 'Dr. Kalluri Rama Kotaiah',
    role: 'PRINCIPAL',
    image: '/visionaries/principal.png',
    roleBadgeStyle: 'text-purple-700 bg-purple-50 border-purple-200',
    paragraphs: [
      'Dr. Kalluri Rama Kotaiah was born in Lakshmipuram, Prakasam District.',
      'He graduated in Mechanical Engineering in the year 1998 and completed his Masters in Engineering in the year 2000 from Ranchi University, Ranchi, Jharkhand. Prof. Rama Kotaiah has been awarded Ph.D in the faculty of Mechanical Engineering from SCSVMV University, Kancheepuram, Tamilnadu.',
      'Dr. Kalluri Rama Kotaiah has 23 years experience in teaching and 02 years in Industry. He joined as a Lecturer in the department of mechanical engineering in the year 2000 at KL University (formerly K.L College of engineering). In the subsequent years he was promoted as senior lecturer, Asst. Professor and Professor. He occupied many administrative positions in KL University. Later, he worked as a Professor & HOD in KITS, Guntur from 2016 to 2023.',
      'He took research degree in the field of Micro Machining and published over 36 scopus indexed journal papers and presented 6 papers in conferences. He attended many teacher training workshops conducted by IIT’s under Quality Improvement Program.',
      'He is the reviewer of International Journal of Advanced Manufacturing Technology and also for International Journal of Machining and Machinability. He is a recognized Supervisor for Ph.D. scholars under JNTU Hyderabad and KL University. He has guided Six research scholars for the award of Ph.D degree and 02 students are presently working under his guidance.',
    ],
  },
];

export function Vision() {
  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-16">
      {/* =========================================================================
          1. COMPACT PAGE HEADER
          ========================================================================= */}
      <section className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-10 shadow-2xs relative overflow-hidden stagger-1">
        {/* Subtle decorative background blur */}
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-gradient-to-br from-blue-50 to-red-50 rounded-full blur-3xl opacity-60 pointer-events-none" />

        <div className="relative z-10 space-y-3 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-black bg-blue-50 text-kits-blue border border-blue-100">
            <Award className="h-3.5 w-3.5" />
            <span>Institutional Leadership</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-gray-900 tracking-tight">
            OUR <span className="text-kits-red">VISIONARIES</span>
          </h1>

          <p className="text-sm sm:text-base font-bold text-gray-800">
            The Minds Behind KITS Akshar Institute of Technology
          </p>

          <p className="text-xs sm:text-sm text-gray-600 leading-relaxed font-normal pt-1">
            Meet the visionary leaders whose direction, governance, and lifelong commitment to academic excellence 
            shape KITS Akshar Institute of Technology into a premier center for technical education, student innovation, 
            and collegiate distinction.
          </p>
        </div>
      </section>

      {/* =========================================================================
          2. LEADERSHIP CARDS GRID (2-COLUMN RESPONSIVE WITH SCROLL REVEAL)
          ========================================================================= */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {VISIONARIES.map((leader, index) => (
          <RevealOnScroll key={index} delay={index * 80}>
            <article
              className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-2xs hover:border-gray-300 card-hover-interactive flex flex-col justify-between space-y-6"
            >
              {/* Top: Portrait & Leadership Identity */}
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left border-b border-gray-100 pb-5">
                <div className="relative shrink-0">
                  <img
                    src={leader.image}
                    alt={`${leader.name} - ${leader.role} of KITS Akshar Institute of Technology`}
                    className="h-28 w-28 sm:h-32 sm:w-32 rounded-2xl object-cover border-2 border-gray-100 shadow-2xs hover:scale-102 transition duration-200"
                    loading="eager"
                    decoding="async"
                  />
                  <div className="absolute -bottom-2.5 left-1/2 transform -translate-x-1/2 sm:hidden">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-2xs ${leader.roleBadgeStyle}`}
                    >
                      {leader.role}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span
                    className={`hidden sm:inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${leader.roleBadgeStyle}`}
                  >
                    {leader.role}
                  </span>

                  <h2 className="text-lg sm:text-xl font-black text-gray-900 tracking-tight">
                    {leader.name}
                  </h2>

                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-gray-400">
                    KITS Akshar Institute of Technology
                  </p>
                </div>
              </div>

              {/* Bottom: Authoritative Biography */}
              <div className="space-y-3 text-xs sm:text-[13px] text-gray-600 font-normal leading-relaxed">
                {leader.paragraphs.map((p, pIdx) => (
                  <p key={pIdx}>{p}</p>
                ))}
              </div>
            </article>
          </RevealOnScroll>
        ))}
      </section>

      {/* =========================================================================
          3. INSTITUTIONAL FOOTER CTA
          ========================================================================= */}
      <RevealOnScroll delay={100}>
        <section className="bg-gray-900 text-white rounded-3xl p-8 sm:p-10 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-md card-hover-interactive">
          <div className="space-y-1 text-center sm:text-left">
            <h3 className="text-lg sm:text-xl font-black tracking-tight">
              Explore Academic & Technical Events at KITS Akshar
            </h3>
            <p className="text-xs text-gray-400">
              Participate in college symposiums, hackathons, and technical presentations.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/events"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition shadow-2xs"
            >
              <span>Explore Events</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/about-keos"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white text-gray-900 text-xs font-black uppercase tracking-wider hover:bg-gray-100 active:scale-95 transition shadow-2xs"
            >
              <span>About K-EOS</span>
            </Link>
          </div>
        </section>
      </RevealOnScroll>
    </div>
  );
}
