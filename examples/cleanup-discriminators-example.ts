#!/usr/bin/env tsx
// Example demonstrating the new removeDiscriminatorPatterns option
import { cleanupDiscriminatorMappings } from '../src/lib/cleanupDiscriminatorMappings.js';

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'Test API',
    version: '1.0.0'
  },
  paths: {},
  components: {
    schemas: {
      // This schema matches *_RES pattern - discriminator will be removed
      Animal_RES: {
        type: 'object',
        properties: {
          type: { type: 'string' }
        },
        discriminator: {
          propertyName: 'type',
          mapping: {
            'Cat': '#/components/schemas/Cat',
            'Dog': '#/components/schemas/Dog'
          }
        }
      },
      
      // This schema matches *Response pattern - discriminator will be removed
      VehicleResponse: {
        type: 'object',
        properties: {
          kind: { type: 'string' }
        },
        discriminator: {
          propertyName: 'kind',
          mapping: {
            'Car': '#/components/schemas/Car'
          }
        }
      },
      
      // This schema doesn't match patterns - discriminator will be kept
      Person: {
        type: 'object',
        properties: {
          type: { type: 'string' }
        },
        discriminator: {
          propertyName: 'type',
          mapping: {
            'Employee': '#/components/schemas/Employee',
            'NonExistent': '#/components/schemas/NonExistent' // This invalid mapping will be removed
          }
        }
      },
      
      Cat: { type: 'object' },
      Dog: { type: 'object' },
      Car: { type: 'object' },
      Employee: { type: 'object' }
    }
  }
};

console.log('Before cleanup:');
console.log('  Animal_RES has discriminator:', !!doc.components.schemas.Animal_RES.discriminator);
console.log('  VehicleResponse has discriminator:', !!doc.components.schemas.VehicleResponse.discriminator);
console.log('  Person has discriminator:', !!doc.components.schemas.Person.discriminator);

// Apply cleanup with patterns
const result = cleanupDiscriminatorMappings(doc, {
  removeDiscriminatorPatterns: ['*_RES', '*Response']
});

console.log('\nCleanup results:');
console.log('  Discriminators removed:', result.discriminatorsRemoved);
console.log('  Schemas affected:', result.removedDiscriminators.join(', '));
console.log('  Schemas checked for invalid mappings:', result.schemasChecked);
console.log('  Invalid mappings removed:', result.mappingsRemoved);

console.log('\nAfter cleanup:');
console.log('  Animal_RES has discriminator:', !!doc.components.schemas.Animal_RES.discriminator);
console.log('  VehicleResponse has discriminator:', !!doc.components.schemas.VehicleResponse.discriminator);
console.log('  Person has discriminator:', !!doc.components.schemas.Person.discriminator);

if (doc.components.schemas.Person.discriminator) {
  console.log('  Person discriminator mappings:', Object.keys(doc.components.schemas.Person.discriminator.mapping || {}));
}
