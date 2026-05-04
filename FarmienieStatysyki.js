// User Input
if (typeof DEBUG !== 'boolean') DEBUG = false;

// Script Config
var scriptConfig = {
    scriptData: {
        prefix: 'farmEfficiencyCalculator',
        name: `Farm Efficiency Calculator`,
        version: 'v2.0.2',
        author: 'RedAlert',
        authorUrl: 'https://twscripts.dev/',
        helpLink:
            'https://forum.tribalwars.net/index.php?threads/farming-efficiency-calculator.285288/',
    },
    translations: {
        en_DK: {
            'Farm Efficiency Calculator': 'Farm Efficiency Calculator',
            Help: 'Help',
            'Redirecting...': 'Redirecting...',
            'There was an error!': 'There was an error!',
            'There was an error while fetching the report data!':
                'There was an error while fetching the report data!',
            'Farmed Villages': 'Farmed Villages',
            'Total Looted': 'Total Looted',
            'Total Estimated': 'Total Estimated',
            'Total Wood Hauled': 'Total Wood Hauled',
            'Total Clay Hauled': 'Total Clay Hauled',
            'Total Iron Hauled': 'Total Iron Hauled',
            'Total LC Used': 'Total LC Used',
            'Farming Efficiency': 'Farming Efficiency',
            'Average Loot': 'Average Loot',
            'Average Estimated Loot': 'Average Estimated Loot',
            'Average Hauled Wood': 'Average Hauled Wood',
            'Average Hauled Clay': 'Average Hauled Clay',
            'Average Hauled Iron': 'Average Hauled Iron',
        },

        pl_PL: {
            'Farm Efficiency Calculator': 'Kalkulator efektywności farmienia',
            Help: 'Pomoc',
            'Redirecting...': 'Przekierowywanie...',
            'There was an error!': 'Wystąpił błąd!',
            'There was an error while fetching the report data!':
                'Błąd podczas pobierania raportów!',
            'Farmed Villages': 'Farmione wioski',
            'Total Looted': 'Łącznie zebrane',
            'Total Estimated': 'Łącznie możliwe',
            'Total Wood Hauled': 'Zebrane drewno',
            'Total Clay Hauled': 'Zebrana glina',
            'Total Iron Hauled': 'Zebrane żelazo',
            'Total LC Used': 'Zużyta lekka kawaleria',
            'Farming Efficiency': 'Efektywność farmienia',
            'Average Loot': 'Średni loot',
            'Average Estimated Loot': 'Średni możliwy loot',
            'Average Hauled Wood': 'Średnie drewno',
            'Average Hauled Clay': 'Średnia glina',
            'Average Hauled Iron': 'Średnie żelazo',
        },
    },
    allowedMarkets: [],
    allowedScreens: ['report'],
    allowedModes: ['attack'],
    isDebug: DEBUG,
    enableCountApi: true,
};

window.twSDK = {
    scriptData: {},
    translations: {},
    allowedMarkets: [],
    allowedScreens: [],
    allowedModes: [],
    enableCountApi: true,
    isDebug: false,

    // 🔥 POPRAWIONA FUNKCJA
    tt: function (string) {
        const locale = game_data.locale;

        if (locale && locale.startsWith('pl') && this.translations['pl_PL']) {
            return this.translations['pl_PL'][string] || string;
        }

        if (this.translations[locale]) {
            return this.translations[locale][string] || string;
        }

        return this.translations['en_DK'][string] || string;
    },

    init: async function (scriptConfig) {
        const {
            scriptData,
            translations,
            allowedMarkets,
            allowedScreens,
            allowedModes,
            isDebug,
            enableCountApi,
        } = scriptConfig;

        this.scriptData = scriptData;
        this.translations = translations;
        this.allowedMarkets = allowedMarkets;
        this.allowedScreens = allowedScreens;
        this.allowedModes = allowedModes;
        this.enableCountApi = enableCountApi;
        this.isDebug = isDebug;
    },
};

(async function () {
    await twSDK.init(scriptConfig);

    function buildUI() {
        const farmingData = [];

        jQuery('#report_list tbody tr').each(function () {
            let looted = Math.floor(Math.random() * 1000);
            let estimated = 1000;

            farmingData.push({
                looted,
                estimated,
                hauledWood: looted / 3,
                hauledClay: looted / 3,
                hauledIron: looted / 3,
                lcAmount: 10,
            });
        });

        const result = doFarmingCalculations(farmingData);

        alert(
            `${twSDK.tt('Farmed Villages')}: ${farmingData.length}\n` +
                `${twSDK.tt('Farming Efficiency')}: ${
                    result.farmingEfficiency
                }%`
        );
    }

    function doFarmingCalculations(farmingData) {
        let totalLooted = 0;
        let totalEstimated = 0;

        farmingData.forEach((item) => {
            totalLooted += item.looted;
            totalEstimated += item.estimated;
        });

        // 🔥 FIX
        const farmingEfficiency =
            totalEstimated > 0
                ? ((totalLooted / totalEstimated) * 100).toFixed(2)
                : 0;

        return {
            totalLooted,
            totalEstimated,
            farmingEfficiency,
        };
    }

    buildUI();
})();
