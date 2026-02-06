// TODO  
// 1. Identify all schemas that have discriminators - then keep only these that have more than a single entry in the mapping (i.e. actually discriminate something)
// 2. Build inheritnace graph for allOf (transitive closure)
// 3. For all schemas from (1) check if any of them is referenced directly - find all references to that schema and from the set remove those that are allOf, anyOf, oneOf. 
//    keep all the references (users) of the scheams (polimorphic parents)
// 4. For each polimorphic parent:
// 4.1 Find all children (plugable but by default ussing mapping information)
// 4.2 Validate children - check if directly or indirecly inherit from the parent, if not - ignore (keep) and print warning
// 4.3 Create polimorphic type (ParentSchemaPolymorphic - the suffix is configurable) with oneOf of all children and discriminator with mappings
// 4.4 remove discriminator mappign from parent


