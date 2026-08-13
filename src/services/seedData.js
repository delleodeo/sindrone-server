// FILE: server/src/services/seedData.js
import { Recommendation } from '../models/Recommendation.js';
import { logger } from '../utils/logger.js';

// Core disease recommendation data based on the 4 classes from Teachable Machine model
const seedRecommendations = [
  {
    diseaseKey: 'healthy',
    displayName: 'Healthy Citrus',
    summary: 'Your citrus leaves appear healthy. Continue good agricultural practices to maintain plant health.',
    symptoms: [
      'Dark green, glossy leaves',
      'No spots, discoloration, or unusual markings',
      'Good leaf structure and firmness',
      'Normal leaf size and shape'
    ],
    causes: [
      'Proper nutrition and water management',
      'Good air circulation and sunlight exposure',
      'Effective pest and disease prevention practices'
    ],
    treatmentSteps: [
      'Continue current care routine',
      'Monitor regularly for early signs of issues',
      'Maintain consistent watering schedule',
      'Ensure adequate fertilization as per soil test recommendations'
    ],
    preventionSteps: [
      'Apply balanced fertilizer every 6-8 weeks during growing season',
      'Water deeply but infrequently to encourage deep root growth',
      'Prune for good air circulation and light penetration',
      'Keep area around tree clean of fallen leaves and debris',
      'Apply organic mulch around base, keeping away from trunk'
    ],
    severity: 'low',
    whenToEscalate: [
      'If you notice any unusual spots or discoloration appearing',
      'If leaves begin yellowing or dropping unexpectedly',
      'If growth rate significantly decreases'
    ],
    references: [
      'University of California Citrus Production Guidelines',
      'Integrated Pest Management for Citrus - UC IPM'
    ]
  },
  {
    diseaseKey: 'black-spot',
    displayName: 'Citrus Black Spot',
    summary: 'Citrus Black Spot is a fungal disease that causes dark lesions on leaves and fruit, potentially reducing crop quality and yield.',
    symptoms: [
      'Small dark brown to black spots on leaves',
      'Spots may have yellow halos around them',
      'Lesions can appear on fruit as well',
      'Severely affected leaves may drop prematurely',
      'Fruit spots can lead to cracking and quality loss'
    ],
    causes: [
      'Fungal infection by Phyllosticta citricarpa',
      'Warm, humid weather conditions favor development',
      'Poor air circulation around plants',
      'Overhead irrigation creating leaf wetness',
      'Infected plant debris left around trees'
    ],
    treatmentSteps: [
      'Remove and destroy affected leaves and fallen debris immediately',
      'Apply copper-based fungicide every 2-3 weeks during wet season',
      'Improve air circulation by pruning dense growth',
      'Switch to drip irrigation to avoid wetting leaves',
      'Apply protective fungicide sprays before rainy season starts'
    ],
    preventionSteps: [
      'Plant resistant citrus varieties when possible',
      'Ensure proper spacing between trees for air circulation',
      'Use drip irrigation instead of overhead sprinklers',
      'Apply preventive copper sprays monthly during high-risk periods',
      'Clean up and compost all fallen leaves and debris',
      'Avoid working in grove when leaves are wet'
    ],
    severity: 'medium',
    whenToEscalate: [
      'If spots continue spreading despite treatment after 4-6 weeks',
      'If fruit quality is significantly affected',
      'If more than 25% of leaves are affected',
      'If you notice the disease spreading to other trees'
    ],
    references: [
      'Citrus Black Spot Management - University of Florida IFAS',
      'Fungicide Resistance Management Guidelines'
    ]
  },
  {
    diseaseKey: 'canker',
    displayName: 'Citrus Canker',
    summary: 'Citrus Canker is a serious bacterial disease causing raised lesions on leaves, stems, and fruit that can significantly impact tree health.',
    symptoms: [
      'Raised, corky lesions with yellow halos on leaves',
      'Brown to tan colored spots that become raised and cork-like',
      'Lesions on fruit appear as raised, rough spots',
      'Severe infections can cause leaf drop and twig dieback',
      'Fruit lesions make fruit unmarketable and prone to secondary infections'
    ],
    causes: [
      'Bacterial infection by Xanthomonas axonopodis',
      'Spread through rain splash, wind, and contaminated equipment',
      'Entry through natural openings and wounds',
      'Warm, humid conditions with frequent rainfall',
      'Poor sanitation and contaminated tools'
    ],
    treatmentSteps: [
      'Immediately remove and burn all affected plant material',
      'Apply copper bactericide sprays every 7-14 days during active growth',
      'Disinfect all pruning tools with 70% alcohol between cuts',
      'Avoid overhead irrigation to minimize leaf wetness',
      'Consider systemic bactericide applications for severe infections',
      'Implement strict quarantine measures to prevent spread'
    ],
    preventionSteps: [
      'Use certified disease-free planting material',
      'Maintain proper tree spacing for air circulation',
      'Apply preventive copper sprays before rainy seasons',
      'Disinfect equipment regularly, especially during wet weather',
      'Avoid cultivation and pruning during wet conditions',
      'Install windbreaks to reduce wind-driven rain',
      'Regular monitoring and early detection programs'
    ],
    severity: 'high',
    whenToEscalate: [
      'Immediately - this is a quarantine disease in many areas',
      'Contact local agricultural extension office for diagnosis confirmation',
      'If disease appears to be spreading to neighboring trees',
      'Before implementing any major control measures',
      'If you suspect this is your first detection of canker in the area'
    ],
    references: [
      'Citrus Canker Management - USDA APHIS',
      'Florida Citrus Canker Eradication Program Guidelines'
    ]
  },
  {
    diseaseKey: 'greening',
    displayName: 'Citrus Greening (HLB)',
    summary: 'Citrus Greening is a devastating bacterial disease that causes yellow shoots, asymmetric mottling, and eventually tree death.',
    symptoms: [
      'Yellow shoots and branches (blotchy mottle pattern)',
      'Asymmetric chlorosis across leaf midrib',
      'Small, lopsided fruit that remains green at maturity',
      'Bitter, unusable fruit with aborted seeds',
      'Branch dieback and eventual tree decline',
      'Stunted growth and reduced fruit production'
    ],
    causes: [
      'Bacterial infection by Candidatus Liberibacter species',
      'Transmitted primarily by Asian citrus psyllid insects',
      'Also spread through grafting infected plant material',
      'No cure available - management focuses on prevention',
      'Infected trees become systemic and cannot be cured'
    ],
    treatmentSteps: [
      'Confirm diagnosis with professional PCR testing immediately',
      'Remove infected trees completely if confirmed positive',
      'Implement intensive psyllid control program',
      'Apply systemic insecticides for psyllid management',
      'Monitor remaining trees closely for symptoms',
      'Report confirmed cases to agricultural authorities'
    ],
    preventionSteps: [
      'Aggressive Asian citrus psyllid monitoring and control',
      'Use only certified, disease-free nursery stock',
      'Apply regular systemic insecticide treatments',
      'Remove any citrus family plants that could harbor psyllids',
      'Implement area-wide psyllid management programs',
      'Regular tree inspection and early detection',
      'Support research for resistant varieties'
    ],
    severity: 'high',
    whenToEscalate: [
      'Immediately - contact agricultural extension for professional diagnosis',
      'This disease requires immediate reporting in most areas',
      'Professional PCR testing needed for confirmation',
      'Coordinate with neighbors for area-wide management',
      'Before removing any trees to ensure proper protocols'
    ],
    references: [
      'Citrus Greening (HLB) Management - University of Florida',
      'USDA Citrus Health Response Program',
      'International HLB Research Coordination'
    ]
  }
];

// Seed the database with core recommendations
export const seedDatabase = async () => {
  try {
    logger.info('Starting database seeding...');

    // Clear existing recommendations
    await Recommendation.deleteMany({});
    logger.info('Cleared existing recommendations');

    // Insert seed data
    const inserted = await Recommendation.insertMany(seedRecommendations);
    logger.info(`Seeded ${inserted.length} recommendations successfully`);

    return {
      success: true,
      message: `Successfully seeded ${inserted.length} recommendations`,
      data: inserted.map(rec => ({
        diseaseKey: rec.diseaseKey,
        displayName: rec.displayName,
        severity: rec.severity
      }))
    };

  } catch (error) {
    logger.error('Database seeding failed', { error: error.message });
    throw new Error(`Seeding failed: ${error.message}`);
  }
};

// Run seeding if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // This allows running the script directly with: node seedData.js
  import('../config/database.js').then(async ({ default: connectDB }) => {
    try {
      await connectDB();
      const result = await seedDatabase();
      console.log('✅ Seeding completed:', result.message);
      process.exit(0);
    } catch (error) {
      console.error('❌ Seeding failed:', error.message);
      process.exit(1);
    }
  });
}