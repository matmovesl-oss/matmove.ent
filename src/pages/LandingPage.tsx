import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Truck, Package, Bike, ChevronRight, ChevronLeft } from 'lucide-react';

const slides = [
  {
    id: 1,
    title: "For Your Family",
    desc: "Safe, spacious rides for weekend getaways, school runs, and everyday life in Freetown.",
    image: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?q=80&w=2000&auto=format&fit=crop",
    tag: "Riders"
  },
  {
    id: 2,
    title: "For Our Drivers",
    desc: "Flexible hours, better earnings, and a community that cares. Drive on your own terms.",
    image: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?q=80&w=2000&auto=format&fit=crop",
    tag: "Partners"
  },
  {
    id: 3,
    title: "For Merchants",
    desc: "Seamless logistics, heavy cargo transport, and instant digital payments to grow your business.",
    image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2000&auto=format&fit=crop",
    tag: "Business"
  }
];

export function LandingPage() {
  const navigate = useNavigate();
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % slides.length);
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);

  return (
    <div className="min-h-screen bg-slate-50 overflow-hidden font-sans">
      <nav className="absolute top-0 w-full z-50 px-6 py-4 flex justify-between items-center max-w-7xl mx-auto left-0 right-0">
        <div className="flex items-center">
          <img src="/logo.jpg" alt="MatMove" className="h-14 w-auto object-contain mix-blend-multiply" />
        </div>
        <div className="flex gap-4">
          <button onClick={() => navigate('/login')} className="px-5 py-2.5 text-slate-600 font-medium hover:text-[#184f9a] transition-colors">Log in</button>
          <button onClick={() => navigate('/signup')} className="px-5 py-2.5 bg-[#184f9a] text-white font-medium rounded-xl hover:bg-[#123e7a] hover:shadow-lg hover:shadow-[#184f9a]/30 transition-all">Get Started</button>
        </div>
      </nav>

      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 px-6 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12">
        <div className="w-full lg:w-1/2 relative z-10 space-y-8">
          <h1 className="text-5xl lg:text-7xl font-extrabold text-slate-900 leading-[1.1] tracking-tight">
            Moving <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#32a84a] to-[#184f9a]">Sierra Leone</span> Forward.
          </h1>
          <p className="text-xl text-slate-600 max-w-xl leading-relaxed">
            The all-in-one platform for rides, deliveries, and merchant payments. Safe, reliable, and built for our community.
          </p>
          <div className="flex flex-wrap gap-4 pt-4">
            <button onClick={() => navigate('/signup')} className="px-8 py-4 bg-[#184f9a] text-white font-semibold rounded-2xl hover:bg-[#123e7a] hover:shadow-xl hover:-translate-y-1 transition-all flex items-center gap-2">
              Get Started <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="w-full lg:w-1/2 relative z-10 h-[450px] lg:h-[550px] rounded-3xl overflow-hidden shadow-2xl group bg-slate-900">
          {slides.map((slide, index) => (
            <div key={slide.id} className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentSlide ? 'opacity-100' : 'opacity-0'}`}>
              <img src={slide.image} alt={slide.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent" />
              <div className="absolute bottom-0 left-0 p-8 lg:p-12 w-full text-white transform transition-transform duration-700 translate-y-0">
                <span className="inline-block px-3 py-1 bg-[#32a84a] rounded-full text-xs font-bold tracking-wider mb-4 uppercase">{slide.tag}</span>
                <h3 className="text-3xl font-bold mb-3">{slide.title}</h3>
                <p className="text-slate-200 text-lg max-w-md">{slide.desc}</p>
              </div>
            </div>
          ))}
          <div className="absolute top-1/2 -translate-y-1/2 w-full px-4 flex justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button onClick={prevSlide} className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white hover:bg-white hover:text-slate-900 transition-colors"><ChevronLeft size={24} /></button>
            <button onClick={nextSlide} className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white hover:bg-white hover:text-slate-900 transition-colors"><ChevronRight size={24} /></button>
          </div>
        </div>
      </section>

      {/* MODERN SERVICE CARDS SECTION */}
      <section className="py-24 bg-white relative z-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight mb-4">One App. Endless Possibilities.</h2>
            <p className="text-lg text-slate-500">From a quick trip to Lumley Beach to moving goods across the peninsula, we have a vehicle for it.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'Standard Ride', desc: 'Comfortable everyday trips', icon: <Car size={24} />, color: 'text-blue-600', bg: 'bg-blue-50' },
              { title: 'Quick Delivery', desc: 'Send packages securely', icon: <Package size={24} />, color: 'text-orange-500', bg: 'bg-orange-50' },
              { title: 'Freight & Truck', desc: 'Move heavy materials', icon: <Truck size={24} />, color: 'text-green-600', bg: 'bg-green-50' },
              { title: 'Group Bus', desc: 'Travel together easily', icon: <Bike size={24} />, color: 'text-purple-600', bg: 'bg-purple-50' },
            ].map((s, i) => (
              <div key={i} className="group p-8 rounded-[2rem] border border-slate-100 bg-white shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300 flex flex-col items-start cursor-pointer">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${s.bg} ${s.color}`}>
                  {s.icon}
                </div>
                <h3 className="font-bold text-xl text-slate-900 mb-2">{s.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}