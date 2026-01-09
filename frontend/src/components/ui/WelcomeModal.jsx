import { useState, useEffect } from 'react';

function WelcomeModal() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        // Check if seen in THIS browser session
        const hasSeenWelcome = sessionStorage.getItem('hasSeenWelcome');
        if (!hasSeenWelcome) {
            setIsOpen(true);
        }
    }, []);

    const handleClose = () => {
        sessionStorage.setItem('hasSeenWelcome', 'true');
        setIsOpen(false);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="bg-gradient-to-br from-purple-600 to-pink-500 p-8 text-white text-center">
                    <div className="text-5xl mb-4">👋</div>
                    <h2 className="text-3xl font-bold font-heading">Welkom bij Know Your VIP!</h2>
                    <p className="mt-2 opacity-90">Jouw assistent voor VIP gastonderzoek</p>
                </div>

                <div className="p-8 space-y-6">
                    <div className="space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0 font-bold">1</div>
                            <div>
                                <h4 className="font-semibold">Importeer Gasten</h4>
                                <p className="text-sm text-gray-600">Upload je Mews Excel export bij 'Importeren'.</p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0 font-bold">2</div>
                            <div>
                                <h4 className="font-semibold">Automatisch Onderzoek</h4>
                                <p className="text-sm text-gray-600">Het onderzoek start direct op de achtergrond. Je hoeft niets te doen.</p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0 font-bold">3</div>
                            <div>
                                <h4 className="font-semibold">Bekijk & Download</h4>
                                <p className="text-sm text-gray-600">Zie VIP scores in de lijst en download volledige rapporten als PDF.</p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleClose}
                        className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-all shadow-lg hover:shadow-purple-200"
                    >
                        Aan de slag
                    </button>
                </div>
            </div>
        </div>
    );
}

export default WelcomeModal;
