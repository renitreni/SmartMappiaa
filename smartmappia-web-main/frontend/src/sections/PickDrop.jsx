import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Home, Plane, ArrowRight } from "lucide-react";
import CustomDropdown from "../components/CustomDropdown";
import { Field } from "../portal/components/ui";
import { AIRPORTS, fareBreakdown } from "../portal/lib/constants";

const FARE = fareBreakdown();
const DISTRICTS = ["Malaz", "Sulamania", "Olaya", "Batha"];

const AIRPORT_OPTIONS = AIRPORTS.map((ap) => ({ value: ap.id, label: ap.name }));
const DISTRICT_OPTIONS = DISTRICTS.map((dist) => ({ value: dist, label: `${dist} District` }));

const PickDrop = () => {
    const [serviceType, setServiceType] = useState("house_to_airport");
    const [airportId, setAirportId] = useState(AIRPORTS[0].id);
    const [district, setDistrict] = useState("Olaya");

    const bookUrl = useMemo(() => {
        const params = new URLSearchParams({
            direction: serviceType,
            airport: airportId,
            district,
        });
        return `/book?${params.toString()}`;
    }, [serviceType, airportId, district]);

    return (
        <section id="pick-drop" className="w-full bg-brand-muted px-8 md:px-20 py-24 border-t border-brand-border">
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                    >
                    <span className="text-brand-orange text-sm font-bold tracking-widest uppercase">Premium Airport Transfer</span>
                    <h2 className="text-4xl md:text-5xl font-black tracking-tight text-brand-black mt-4 leading-tight">
                        Reliable Airport <br />Pick & Drop Service.
                    </h2>
                    <p className="text-brand-grey text-base md:text-lg mt-6 leading-relaxed">
                        Eliminate airport travel stress. SmartMappia delivers secure, punctual airport transfer services within Riyadh. Experience a seamless ride from your doorstep directly to the terminal, or get picked up right as you land.
                    </p>

                    <div className="mt-8 space-y-4">
                        <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center text-xs">✓</span>
                        <span className="text-brand-dark font-medium">Covering top Riyadh districts (Olaya, Sulamania, Malaz, Batha)</span>
                        </div>
                        <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center text-xs">✓</span>
                        <span className="text-brand-dark font-medium">Fixed and transparent rates per trip (No hidden charges)</span>
                        </div>
                        <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-brand-orange/15 text-brand-orange flex items-center justify-center text-xs">✓</span>
                        <span className="text-brand-dark font-medium">24/7 Driver & User Secure App Access Authentication</span>
                        </div>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                    className="bg-white border border-brand-border rounded-3xl p-8 shadow-xl relative overflow-visible"
                    >
                    <h3 className="text-xl font-black text-brand-black mb-6 tracking-tight">Fare Estimator</h3>
                    
                    <div className="grid grid-cols-2 gap-2 bg-brand-surface p-1.5 rounded-xl border border-brand-border mb-6">
                        <button
                            type="button"
                            onClick={() => setServiceType("house_to_airport")}
                            className={`py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                                serviceType === "house_to_airport"
                                    ? "bg-brand-orange text-white shadow-md shadow-brand-orange/20"
                                    : "text-brand-grey hover:text-brand-dark"
                            }`}
                        >
                            <Home size={16} />
                            House
                            <ArrowRight size={14} />
                            <Plane size={16} />
                            Airport
                        </button>
                        <button
                            type="button"
                            onClick={() => setServiceType("airport_to_house")}
                            className={`py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                                serviceType === "airport_to_house"
                                    ? "bg-brand-orange text-white shadow-md shadow-brand-orange/20"
                                    : "text-brand-grey hover:text-brand-dark"
                            }`}
                        >
                            <Plane size={16} />
                            Airport
                            <ArrowRight size={14} />
                            <Home size={16} />
                            House
                        </button>
                    </div>

                    <div className="space-y-5 overflow-visible">
                        <Field label="Select Airport Terminal">
                            <CustomDropdown
                                value={airportId}
                                onChange={setAirportId}
                                options={AIRPORT_OPTIONS}
                                allowEmpty={false}
                            />
                        </Field>

                        <Field label="Select Your Riyadh District">
                            <CustomDropdown
                                value={district}
                                onChange={setDistrict}
                                options={DISTRICT_OPTIONS}
                                allowEmpty={false}
                            />
                        </Field>
                    </div>

                    <div className="mt-8 pt-6 border-t border-brand-border space-y-2">
                        <div className="flex justify-between text-sm text-brand-grey">
                            <span>Base fare</span>
                            <span>SAR {FARE.base.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-brand-grey">
                            <span>Service fee ({FARE.serviceFeePercent}%)</span>
                            <span>SAR {FARE.serviceFee.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between pt-2">
                            <div>
                                <span className="text-xs font-bold text-brand-grey uppercase tracking-wider block">Total</span>
                                <span className="text-sm text-brand-grey">Per single trip</span>
                            </div>
                            <motion.span
                                key={FARE.total}
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-3xl font-black text-brand-orange"
                            >
                                SAR {FARE.total.toFixed(2)}
                            </motion.span>
                        </div>
                    </div>

                    <Link
                        to={bookUrl}
                        className="block w-full bg-brand-orange hover:bg-brand-orange/90 text-white font-black py-4 rounded-xl mt-6 transition-all duration-300 shadow-lg shadow-brand-orange/20 text-center text-sm cursor-pointer"
                    >
                        Book Ride Now
                    </Link>
                </motion.div>

            </div>
        </section>
    );
};

export default PickDrop;
