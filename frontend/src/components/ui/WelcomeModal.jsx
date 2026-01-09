import { useState, useEffect } from 'react';

function WelcomeModal({ forceOpen = false, onClose }) {
    const [isOpen, setIsOpen] = useState(forceOpen);

    useEffect(() => {
        if (forceOpen) {
            setIsOpen(true);
            return;
        }
        // Check if seen in THIS browser session
        const hasSeenWelcome = sessionStorage.getItem('hasSeenWelcome');
        if (!hasSeenWelcome) {
            setIsOpen(true);
        }
    }, [forceOpen]);

    const handleClose = () => {
        if (!forceOpen) {
            sessionStorage.setItem('hasSeenWelcome', 'true');
        }
        setIsOpen(false);
        if (onClose) onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div
                className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
                style={{
                    animation: 'modalSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
            >
                {/* Premium Gold Header */}
                <div
                    className="relative p-10 text-center overflow-hidden"
                    style={{
                        background: 'linear-gradient(135deg, #c9a227 0%, #f4d03f 25%, #c9a227 50%, #f4d03f 75%, #c9a227 100%)',
                        backgroundSize: '200% 200%',
                        animation: 'shimmer 3s ease-in-out infinite'
                    }}
                >
                    {/* Decorative elements */}
                    <div className="absolute top-0 left-0 w-full h-full opacity-20">
                        <div className="absolute top-4 left-4 text-6xl opacity-30">✦</div>
                        <div className="absolute bottom-4 right-4 text-4xl opacity-30">✦</div>
                        <div className="absolute top-1/2 right-8 text-2xl opacity-20">★</div>
                    </div>

                    {/* Crown Icon */}
                    <div
                        className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm mb-4"
                        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}
                    >
                        <span className="text-5xl">👑</span>
                    </div>

                    <h2
                        className="text-3xl font-bold text-white drop-shadow-lg"
                        style={{
                            fontFamily: "'Playfair Display', serif",
                            textShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }}
                    >
                        Know Your VIP
                    </h2>
                    <p className="mt-2 text-white/90 text-sm tracking-wide">
                        Premium Guest Intelligence
                    </p>
                </div>

                {/* Steps Content */}
                <div className="p-8 bg-gradient-to-b from-white to-gray-50">
                    <div className="space-y-5">
                        {/* Step 1 */}
                        <div className="flex items-start gap-4 group">
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white shadow-lg"
                                style={{
                                    background: 'linear-gradient(135deg, #c9a227, #f4d03f)',
                                    boxShadow: '0 4px 14px rgba(201, 162, 39, 0.4)'
                                }}
                            >
                                1
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-800">Importeer Gasten</h4>
                                <p className="text-sm text-gray-500 mt-0.5">Upload je Mews Excel export bij 'Importeren'.</p>
                            </div>
                        </div>

                        {/* Step 2 */}
                        <div className="flex items-start gap-4 group">
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white shadow-lg"
                                style={{
                                    background: 'linear-gradient(135deg, #c9a227, #f4d03f)',
                                    boxShadow: '0 4px 14px rgba(201, 162, 39, 0.4)'
                                }}
                            >
                                2
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-800">Automatisch Onderzoek</h4>
                                <p className="text-sm text-gray-500 mt-0.5">Het systeem start direct. Je hoeft niets te doen.</p>
                            </div>
                        </div>

                        {/* Step 3 */}
                        <div className="flex items-start gap-4 group">
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white shadow-lg"
                                style={{
                                    background: 'linear-gradient(135deg, #c9a227, #f4d03f)',
                                    boxShadow: '0 4px 14px rgba(201, 162, 39, 0.4)'
                                }}
                            >
                                3
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-800">Bekijk & Download</h4>
                                <p className="text-sm text-gray-500 mt-0.5">Bekijk VIP scores en download rapporten als PDF.</p>
                            </div>
                        </div>
                    </div>

                    {/* CTA Button */}
                    <button
                        onClick={handleClose}
                        className="w-full mt-8 py-4 rounded-xl font-semibold text-white transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                        style={{
                            background: 'linear-gradient(135deg, #c9a227, #f4d03f)',
                            boxShadow: '0 6px 20px rgba(201, 162, 39, 0.4)'
                        }}
                    >
                        Aan de slag ✨
                    </button>
                </div>
            </div>

            {/* Custom Keyframes */}
            <style>{`
                @keyframes modalSlideIn {
                    from {
                        opacity: 0;
                        transform: scale(0.9) translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }
                @keyframes shimmer {
                    0%, 100% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                }
            `}</style>
        </div>
    );
}

export default WelcomeModal;
